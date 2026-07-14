import XCTest

@testable import kkrpc

/// An in-memory transport so a channel can be driven without a real socket.
actor FakeTransport: Transport {
    private var incoming: [String] = []
    private var outgoing: [String] = []
    private var waiter: CheckedContinuation<String?, Never>?
    private var closed = false

    func push(_ line: String) {
        if let waiter {
            self.waiter = nil
            waiter.resume(returning: line)
        } else {
            incoming.append(line)
        }
    }

    func sent() -> [String] { outgoing }

    func read() async throws -> String? {
        if !incoming.isEmpty { return incoming.removeFirst() }
        if closed { return nil }
        return await withCheckedContinuation { self.waiter = $0 }
    }

    func write(_ message: String) async throws { outgoing.append(message) }

    func close() async {
        closed = true
        waiter?.resume(returning: nil)
        waiter = nil
    }
}

private actor Received {
    private(set) var value: String?
    func set(_ newValue: String?) { value = newValue }
}

final class RPCChannelTests: XCTestCase {

    /// Spin until `condition` holds — the channel works on background tasks.
    private func waitUntil(_ condition: @Sendable () async -> Bool) async -> Bool {
        for _ in 0..<5000 {
            if await condition() { return true }
            await Task.yield()
        }
        return false
    }

    /// The whole reason this type exists: one connection must both serve and call.
    /// `Client` + `Server` sharing a transport would race for the same messages.
    func testServesAndCallsOverOneTransport() async throws {
        let transport = FakeTransport()
        let channel = RPCChannel(transport: transport)

        await channel.expose("math.add") { args in
            .number((args[0].numberValue ?? 0) + (args[1].numberValue ?? 0))
        }
        await channel.start()

        // Inbound request — we are the callee.
        await transport.push(#"{"t":"q","id":"r1","op":"call","p":["math","add"],"a":[1,2]}"#)
        let replied = await waitUntil { await !transport.sent().isEmpty }
        XCTAssertTrue(replied)

        let sentAfterReply = await transport.sent()
        let reply = try RPCChannel.decode(sentAfterReply[0])
        XCTAssertEqual(reply.objectValue?["t"]?.stringValue, "r")
        XCTAssertEqual(reply.objectValue?["id"]?.stringValue, "r1")
        XCTAssertEqual(reply.objectValue?["v"]?.numberValue, 3)

        // Outbound call on the SAME transport — we are the caller.
        async let pending = channel.call("greet", [.string("hi")])
        let asked = await waitUntil { await transport.sent().count == 2 }
        XCTAssertTrue(asked)

        let sentAfterCall = await transport.sent()
        let request = try RPCChannel.decode(sentAfterCall[1])
        let id = try XCTUnwrap(request.objectValue?["id"]?.stringValue)
        XCTAssertEqual(request.objectValue?["p"]?.arrayValue?.first?.stringValue, "greet")

        await transport.push(#"{"t":"r","id":"\#(id)","v":"hello"}"#)
        let value = try await pending
        XCTAssertEqual(value.stringValue, "hello")
    }

    func testPropagatesRemoteError() async throws {
        let transport = FakeTransport()
        let channel = RPCChannel(transport: transport)
        await channel.start()

        async let pending = channel.call("boom")
        let asked = await waitUntil { await !transport.sent().isEmpty }
        XCTAssertTrue(asked)

        let sent = await transport.sent()
        let id = try XCTUnwrap(RPCChannel.decode(sent[0]).objectValue?["id"]?.stringValue)
        await transport.push(#"{"t":"r","id":"\#(id)","e":{"n":"TypeError","m":"nope"}}"#)

        do {
            _ = try await pending
            XCTFail("expected the remote error to propagate")
        } catch {
            XCTAssertEqual(error as? KkrpcError, .rpcError(name: "TypeError", message: "nope"))
        }
    }

    func testUnknownMethodRepliesWithError() async throws {
        let transport = FakeTransport()
        let channel = RPCChannel(transport: transport)
        await channel.start()

        await transport.push(#"{"t":"q","id":"x","op":"call","p":["missing"],"a":[]}"#)
        let replied = await waitUntil { await !transport.sent().isEmpty }
        XCTAssertTrue(replied)

        let sent = await transport.sent()
        let reply = try RPCChannel.decode(sent[0])
        XCTAssertEqual(
            reply.objectValue?["e"]?.objectValue?["m"]?.stringValue, "Method not found: missing")
    }

    /// A throwing handler must surface as an RPC error, not hang the caller.
    func testThrowingHandlerRepliesWithError() async throws {
        let transport = FakeTransport()
        let channel = RPCChannel(transport: transport)
        await channel.expose("fail") { _ in
            throw KkrpcError.rpcError(name: "Error", message: "handler blew up")
        }
        await channel.start()

        await transport.push(#"{"t":"q","id":"e1","op":"call","p":["fail"],"a":[]}"#)
        let replied = await waitUntil { await !transport.sent().isEmpty }
        XCTAssertTrue(replied)

        let sent = await transport.sent()
        let reply = try RPCChannel.decode(sent[0])
        XCTAssertNotNil(reply.objectValue?["e"])
        XCTAssertEqual(reply.objectValue?["id"]?.stringValue, "e1")
    }

    /// Pass a Swift closure to the remote; the remote invokes it (`t: "cb"`).
    func testRemoteInvokesLocalCallback() async throws {
        let transport = FakeTransport()
        let channel = RPCChannel(transport: transport)
        await channel.start()

        let received = Received()
        async let pending = channel.call(
            "withCallback",
            args: [
                .value(.string("test")),
                .callback { args in await received.set(args.first?.stringValue) },
            ])

        let asked = await waitUntil { await !transport.sent().isEmpty }
        XCTAssertTrue(asked)

        let sent = await transport.sent()
        let request = try RPCChannel.decode(sent[0])
        let args = try XCTUnwrap(request.objectValue?["a"]?.arrayValue)

        // The closure must go out as a callback envelope, not as a JSON value.
        let envelope = try XCTUnwrap(args[1].objectValue)
        XCTAssertEqual(envelope[argEnvelopeTag]?.stringValue, "callback")
        let callbackId = try XCTUnwrap(envelope["id"]?.stringValue)

        // Remote invokes the callback, then answers the original call.
        await transport.push(#"{"t":"cb","id":"\#(callbackId)","a":["callback:test"]}"#)
        let invoked = await waitUntil { await received.value != nil }
        XCTAssertTrue(invoked)
        let value = await received.value
        XCTAssertEqual(value, "callback:test")

        let id = try XCTUnwrap(request.objectValue?["id"]?.stringValue)
        await transport.push(#"{"t":"r","id":"\#(id)","v":"ok"}"#)
        _ = try await pending
    }

    func testUnwrapsValueEnvelope() {
        let enveloped = JSONValue.object([
            argEnvelopeTag: .string("value"),
            "v": .string("hello"),
        ])
        XCTAssertEqual(RPCChannel.unwrapArgument(enveloped), .string("hello"))
        XCTAssertEqual(RPCChannel.unwrapArgument(.number(7)), .number(7))
    }

    func testJSONValueRoundTripsCodableModels() throws {
        struct Point: Codable, Equatable {
            let x: Int
            let y: Int
        }
        let value = try JSONValue.encoding(Point(x: 1, y: 2))
        XCTAssertEqual(value.objectValue?["x"]?.numberValue, 1)
        XCTAssertEqual(try value.decode(Point.self), Point(x: 1, y: 2))
    }
}
