import XCTest
@testable import kkrpc

/// A transport that plugs two `Channel`s into each other, so a test can watch
/// both directions on one pair.
private actor LoopbackTransport: Transport {
    private var inbox: [String] = []
    private var waiting: CheckedContinuation<String?, Never>?
    private var isClosed = false
    private var peer: LoopbackTransport?

    func attach(_ peer: LoopbackTransport) {
        self.peer = peer
    }

    func deliver(_ line: String) {
        guard !isClosed else { return }
        if let waiting {
            self.waiting = nil
            waiting.resume(returning: line)
        } else {
            inbox.append(line)
        }
    }

    func read() async throws -> String? {
        if isClosed { return nil }
        if !inbox.isEmpty { return inbox.removeFirst() }
        return await withCheckedContinuation { continuation in
            if isClosed {
                continuation.resume(returning: nil)
            } else {
                waiting = continuation
            }
        }
    }

    func write(_ message: String) async throws {
        guard !isClosed else { throw KkrpcError.transportClosed }
        await peer?.deliver(message.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func close() async {
        isClosed = true
        if let waiting {
            self.waiting = nil
            waiting.resume(returning: nil)
        }
    }
}

final class ChannelTests: XCTestCase {
    /// **The case a `Client` and a `Server` on one transport cannot do.** Both
    /// own a read loop, so a response is as likely to be swallowed by the
    /// serving loop as delivered, and the call hangs. A channel reads once and
    /// splits by tag.
    func testBothSidesCanCallEachOther() async throws {
        let left = LoopbackTransport()
        let right = LoopbackTransport()
        await left.attach(right)
        await right.attach(left)

        let leftChannel = Channel(transport: left, api: [
            "greet": { (args: [Any]) -> Any in
                let name = decodeArgument(args.first ?? NSNull()) as? String ?? "?"
                return "hello \(name)"
            }
        ])
        let rightChannel = Channel(transport: right, api: [
            "double": { (args: [Any]) -> Any in
                let value = decodeArgument(args.first ?? NSNull()) as? Int ?? 0
                return value * 2
            }
        ])

        // Right calls left's API…
        let greeting = try await rightChannel.call(method: "greet", args: ["world"])
        XCTAssertEqual(greeting as? String, "hello world")

        // …and left calls right's, on the same pair of transports, after.
        let doubled = try await leftChannel.call(method: "double", args: [21])
        XCTAssertEqual(doubled as? Int, 42)

        await leftChannel.close()
        await rightChannel.close()
    }

    /// A call in flight from each side at once: the frames interleave on one
    /// transport and each response still has to reach the half that asked.
    func testCallsInBothDirectionsAtOnceDoNotStealEachOthersResponses() async throws {
        let left = LoopbackTransport()
        let right = LoopbackTransport()
        await left.attach(right)
        await right.attach(left)

        let leftChannel = Channel(transport: left, api: [
            "slow": { (_: [Any]) -> Any in "from-left" }
        ])
        let rightChannel = Channel(transport: right, api: [
            "slow": { (_: [Any]) -> Any in "from-right" }
        ])

        async let fromRight = rightChannel.call(method: "slow")
        async let fromLeft = leftChannel.call(method: "slow")
        let answers = try await [fromRight, fromLeft]

        XCTAssertEqual(answers[0] as? String, "from-left", "right asked left")
        XCTAssertEqual(answers[1] as? String, "from-right", "left asked right")

        await leftChannel.close()
        await rightChannel.close()
    }

    /// An error raised by the far side's handler comes back as one.
    func testAFarSideErrorSurfacesAsAnError() async throws {
        let left = LoopbackTransport()
        let right = LoopbackTransport()
        await left.attach(right)
        await right.attach(left)

        let leftChannel = Channel(transport: left, api: [:])
        let rightChannel = Channel(transport: right, api: [:])

        do {
            _ = try await rightChannel.call(method: "notThere")
            XCTFail("a call to a method that does not exist resolved")
        } catch {
            // expected: the serving half answers with an error record
        }

        await leftChannel.close()
        await rightChannel.close()
    }
}
