import Foundation

public let argEnvelopeTag = "__kkrpc_next_arg__"

public enum KkrpcError: Error, Sendable, Equatable {
    case transportClosed
    case encodingError
    case decodingError
    case rpcError(name: String, message: String)
    case connectionFailed
    case webSocketHandshakeFailed
}

public protocol Transport {
    func read() async throws -> String?
    func write(_ message: String) async throws
    func close() async
}

/// Line-delimited JSON over stdio.
///
/// An `actor` rather than a `struct`: writes must be serialized, and taking an
/// `NSLock` inside an `async` function is unavailable under Swift concurrency
/// checking (a hard error in Swift 6). Actor isolation gives the same mutual
/// exclusion without blocking a cooperative thread.
public actor StdioTransport: Transport {
    private let input: FileHandle
    private let output: FileHandle

    public init(input: FileHandle = .standardInput, output: FileHandle = .standardOutput) {
        self.input = input
        self.output = output
    }

    public func read() async throws -> String? {
        let data = input.availableData
        guard !data.isEmpty else { return nil }
        guard let line = String(data: data, encoding: .utf8) else {
            throw KkrpcError.decodingError
        }
        return line.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public func write(_ message: String) async throws {
        guard let data = (message + "\n").data(using: .utf8) else {
            throw KkrpcError.encodingError
        }
        output.write(data)
    }

    public func close() async {}
}

/// One JSON message per WebSocket frame.
///
/// Note the framing: kkrpc's TS WebSocket transport does
/// `socket.send(JSON.stringify(message))` — one message per frame, **no newline
/// terminator**. Newline framing is a stdio rule; appending `\n` here would be
/// wrong (harmless for a tolerant `JSON.parse`, but wrong on the wire).
///
/// `URLSessionWebSocketTask.receive()` is designed to be awaited repeatedly, one
/// call at a time, which is exactly what a single read loop does — so it is used
/// directly. (The previous implementation funnelled frames through an
/// `AsyncStream` and started a fresh `for await` on every `read()`; an
/// `AsyncStream` supports only a *single* iteration, so repeated iteration is
/// undefined behaviour.)
public actor WebSocketTransport: Transport {
    private var url: URL
    private let session: URLSession
    private var task: URLSessionWebSocketTask?
    private var closed = false

    public init(url: URL, session: URLSession = URLSession(configuration: .default)) {
        self.url = url
        self.session = session
    }

    /// Open the socket to the URL this transport was created with.
    public func connect() async throws {
        guard !closed else { throw KkrpcError.transportClosed }
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
    }

    /// Open the socket to an explicit URL.
    public func connect(to url: URL) async throws {
        self.url = url
        try await connect()
    }

    public func read() async throws -> String? {
        guard !closed, let task else { return nil }
        do {
            switch try await task.receive() {
            case .string(let text):
                return text
            case .data(let data):
                return String(data: data, encoding: .utf8)
            @unknown default:
                return nil
            }
        } catch {
            // A cancel() during close surfaces as an error; report a clean EOF.
            if closed { return nil }
            throw error
        }
    }

    public func write(_ message: String) async throws {
        guard !closed, let task else { throw KkrpcError.transportClosed }
        try await task.send(.string(message))
    }

    public func close() async {
        closed = true
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
    }
}
