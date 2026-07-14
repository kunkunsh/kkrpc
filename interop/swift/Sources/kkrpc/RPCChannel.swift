import Foundation

/// An argument to a remote call: either a plain JSON value, or a local closure
/// the remote side can invoke (kkrpc's callback feature).
public enum RPCArg: Sendable {
    case value(JSONValue)
    case callback(@Sendable ([JSONValue]) async -> Void)
}

/// A **bidirectional** kkrpc endpoint over a single transport — the Swift
/// counterpart of TypeScript's `RPCChannel`, which is simultaneously caller and
/// callee on one connection.
///
/// `Client` and `Server` each spawn their own read loop, so putting both on one
/// transport makes them race for the same messages: whichever reads first
/// consumes it and the other stalls forever. That makes it impossible to build
/// anything that must both *serve* and *call* over one socket (a host, a peer, a
/// worker). `RPCChannel` merges both roles behind a single read loop:
///
///     t: "q"  → dispatch to an exposed handler, reply with `t: "r"`
///     t: "r"  → resolve the matching pending `call(...)`
///     t: "cb" → invoke a local closure we previously passed to the remote
///
/// Wire format (compact keys, matching `src/core/channel.ts`):
///
///     request   {"t":"q","id":…,"op":"call","p":["math","add"],"a":[…]}
///     response  {"t":"r","id":…,"v":…}  |  {"t":"r","id":…,"e":{"n":…,"m":…}}
///     callback  {"t":"cb","id":…,"a":[…]}
///
/// Values are plain JSON — kkrpc's default codec is `JSON.stringify`/`JSON.parse`
/// (SuperJSON is opt-in), so a stock TypeScript peer needs no configuration.
public actor RPCChannel {
    /// A method this endpoint exposes to the remote.
    public typealias Handler = @Sendable ([JSONValue]) async throws -> JSONValue

    private let transport: any Transport & Sendable
    private var handlers: [String: Handler] = [:]
    private var pending: [String: CheckedContinuation<Result<JSONValue, KkrpcError>, Never>] = [:]
    private var callbacks: [String: @Sendable ([JSONValue]) async -> Void] = [:]
    private var readTask: Task<Void, Never>?

    public init(transport: any Transport & Sendable) {
        self.transport = transport
    }

    /// Expose a method the remote can call. Dot-notation paths ("math.add") are
    /// matched against the joined request path.
    public func expose(_ method: String, _ handler: @escaping Handler) {
        handlers[method] = handler
    }

    /// Begin reading. Expose everything you serve *before* calling this, so an
    /// eager remote can't hit an unregistered method.
    public func start() {
        guard readTask == nil else { return }
        readTask = Task { await self.readLoop() }
    }

    public func close() async {
        readTask?.cancel()
        readTask = nil
        for (_, continuation) in pending {
            continuation.resume(returning: .failure(.transportClosed))
        }
        pending.removeAll()
        callbacks.removeAll()
        await transport.close()
    }

    // MARK: - Calling the remote

    @discardableResult
    public func call(_ method: String, _ args: [JSONValue] = []) async throws -> JSONValue {
        try await call(method, args: args.map(RPCArg.value))
    }

    /// Call a remote method, optionally passing local closures it can invoke.
    @discardableResult
    public func call(_ method: String, args: [RPCArg]) async throws -> JSONValue {
        let id = generateUUID()
        var encoded: [JSONValue] = []
        for arg in args {
            switch arg {
            case .value(let value):
                encoded.append(value)
            case .callback(let closure):
                let callbackId = generateUUID()
                callbacks[callbackId] = closure
                encoded.append(
                    .object([
                        argEnvelopeTag: .string("callback"),
                        "id": .string(callbackId),
                    ]))
            }
        }

        let message = JSONValue.object([
            "t": .string("q"),
            "id": .string(id),
            "op": .string("call"),
            "p": .array(method.split(separator: ".").map { .string(String($0)) }),
            "a": .array(encoded),
        ])
        let text = try Self.encode(message)

        let result: Result<JSONValue, KkrpcError> = await withCheckedContinuation { continuation in
            pending[id] = continuation
            Task { [transport] in
                do {
                    try await transport.write(text)
                } catch {
                    await self.failPending(id, .rpcError(name: "Transport", message: "\(error)"))
                }
            }
        }
        return try result.get()
    }

    // MARK: - Read loop

    private func readLoop() async {
        while !Task.isCancelled {
            let line: String?
            do {
                line = try await transport.read()
            } catch {
                break
            }
            guard let line else { break }  // transport closed
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty,
                let message = try? Self.decode(trimmed),
                let fields = message.objectValue,
                let type = fields["t"]?.stringValue
            else { continue }

            switch type {
            case "q": await handleRequest(fields)
            case "r": handleResponse(fields)
            case "cb": await handleCallback(fields)
            default: break
            }
        }
    }

    private func handleRequest(_ message: [String: JSONValue]) async {
        guard let id = message["id"]?.stringValue else { return }
        let path = message["p"]?.arrayValue?.compactMap(\.stringValue) ?? []
        let method = path.joined(separator: ".")
        let args = (message["a"]?.arrayValue ?? []).map(Self.unwrapArgument)

        guard let handler = handlers[method] else {
            await post(Self.errorResponse(id: id, name: "Error", message: "Method not found: \(method)"))
            return
        }
        do {
            let value = try await handler(args)
            await post(.object(["t": .string("r"), "id": .string(id), "v": value]))
        } catch {
            let name = (error as? KkrpcError).map { _ in "Error" } ?? "Error"
            await post(Self.errorResponse(id: id, name: name, message: "\(error)"))
        }
    }

    private func handleResponse(_ message: [String: JSONValue]) {
        guard let id = message["id"]?.stringValue,
            let continuation = pending.removeValue(forKey: id)
        else { return }

        if let error = message["e"]?.objectValue {
            continuation.resume(
                returning: .failure(
                    .rpcError(
                        name: error["n"]?.stringValue ?? "Error",
                        message: error["m"]?.stringValue ?? "Unknown error")))
        } else {
            continuation.resume(returning: .success(message["v"] ?? .null))
        }
    }

    private func handleCallback(_ message: [String: JSONValue]) async {
        guard let id = message["id"]?.stringValue, let callback = callbacks[id] else { return }
        await callback((message["a"]?.arrayValue ?? []).map(Self.unwrapArgument))
    }

    private func failPending(_ id: String, _ error: KkrpcError) {
        pending.removeValue(forKey: id)?.resume(returning: .failure(error))
    }

    private func post(_ message: JSONValue) async {
        guard let text = try? Self.encode(message) else { return }
        try? await transport.write(text)
    }

    // MARK: - Codec

    static func errorResponse(id: String, name: String, message: String) -> JSONValue {
        .object([
            "t": .string("r"), "id": .string(id),
            "e": .object(["n": .string(name), "m": .string(message)]),
        ])
    }

    /// kkrpc wraps arguments in `{"__kkrpc_next_arg__": "value", "v": …}` envelopes.
    /// Callback envelopes are left intact — a remote-supplied function is not a
    /// JSON value, and this endpoint does not yet re-expose them as callables.
    static func unwrapArgument(_ value: JSONValue) -> JSONValue {
        guard let envelope = value.objectValue,
            envelope[argEnvelopeTag]?.stringValue == "value"
        else { return value }
        return envelope["v"] ?? .null
    }

    static func encode(_ value: JSONValue) throws -> String {
        let data = try JSONEncoder().encode(value)
        guard let text = String(data: data, encoding: .utf8) else { throw KkrpcError.encodingError }
        return text
    }

    static func decode(_ text: String) throws -> JSONValue {
        guard let data = text.data(using: .utf8) else { throw KkrpcError.decodingError }
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
}
