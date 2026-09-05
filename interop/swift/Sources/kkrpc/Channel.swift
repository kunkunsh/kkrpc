import Foundation

/// One transport, serving both directions.
///
/// ``Client`` and ``Server`` each own a read loop, so putting both on one
/// transport makes them race for frames: a response the client is waiting for is
/// as likely to be swallowed by the server's loop as delivered, and the call
/// hangs until it times out. That is fine for the shapes the interop started
/// with — a Swift process that only serves, or only calls — and wrong for the
/// one this exists for: a native application hosting a page, where **both sides
/// call each other**. The page asks the host for a snapshot; the host pushes a
/// new one when something changes underneath it.
///
/// TypeScript has had this since the beginning — `RPCChannel` is one object with
/// `expose` and `getAPI`. This is the same idea: **one loop, split by tag**.
/// `t == "q"` is a request and goes to the serving half; anything else is a
/// response or a callback and goes to the calling half.
///
/// ```swift
/// let channel = Channel(transport: transport, api: [
///     "ping": { _ in "pong" }
/// ])
/// let answer = try await channel.call(method: "render", args: [payload])
/// ```
public actor Channel {
    private let transport: Transport
    private let server: Server
    private let client: Client
    private var readTask: Task<Void, Never>?

    /// - Parameters:
    ///   - transport: the transport both halves share.
    ///   - api: what the far side may call, in ``Server``'s `[String: Any]` tree.
    public init(transport: Transport, api: [String: Any] = [:]) {
        self.transport = transport
        // **Both halves are given a silent transport, not this one.** Each would
        // otherwise start its own read loop against the real transport, which is
        // the race this type exists to remove. They keep their *write* path,
        // because a write is unambiguous.
        self.server = Server(transport: WriteOnlyTransport(transport), api: api)
        self.client = Client(transport: WriteOnlyTransport(transport))
        Task { await self.start() }
    }

    private func start() {
        guard readTask == nil else { return }
        readTask = Task { [transport, server, client] in
            while !Task.isCancelled {
                let read: String?
                do {
                    read = try await transport.read()
                } catch {
                    break
                }
                // `nil` is the transport saying it is closed, and is the only
                // way this loop ends other than cancellation.
                guard let line = read else { break }
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty, let message = try? decodeMessage(trimmed) else { continue }
                if message["t"] as? String == "q" {
                    await server.accept(trimmed)
                } else {
                    await client.accept(trimmed)
                }
            }
        }
    }

    /// Call the far side.
    public func call(method: String, args: [Any] = []) async throws -> Any? {
        try await client.call(method: method, args: args)
    }

    public func get(path: [String]) async throws -> Any? {
        try await client.get(path: path)
    }

    public func set(path: [String], value: Any) async throws -> Any? {
        try await client.set(path: path, value: value)
    }

    public func close() async {
        readTask?.cancel()
        readTask = nil
        await transport.close()
    }
}

/// A transport that writes through and never reads.
///
/// Handed to the two halves of a ``Channel`` so neither starts a read loop of
/// its own. `read()` suspends until cancelled rather than returning `nil`,
/// because `nil` means *closed* to both loops and would end them immediately.
struct WriteOnlyTransport: Transport {
    private let inner: Transport

    init(_ inner: Transport) {
        self.inner = inner
    }

    func read() async throws -> String? {
        // Parked, not closed. The owning channel does the reading.
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
        }
        return nil
    }

    func write(_ message: String) async throws {
        try await inner.write(message)
    }

    func close() async {
        // The channel owns the real transport's lifetime.
    }
}
