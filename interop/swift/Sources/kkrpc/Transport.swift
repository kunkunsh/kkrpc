import Foundation

public let callbackPrefix = "__callback__"

public enum KkrpcError: Error {
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

public struct StdioTransport: Transport {
    private let input: FileHandle
    private let output: FileHandle
    private let lock = NSLock()
    
    public init(input: FileHandle = .standardInput, output: FileHandle = .standardOutput) {
        self.input = input
        self.output = output
    }
    
    public func read() async throws -> String? {
        guard let data = input.availableData as Data?, !data.isEmpty else {
            return nil
        }
        guard let line = String(data: data, encoding: .utf8) else {
            throw KkrpcError.decodingError
        }
        return line.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    
    public func write(_ message: String) async throws {
        lock.lock()
        defer { lock.unlock() }
        guard let data = (message + "\n").data(using: .utf8) else {
            throw KkrpcError.encodingError
        }
        output.write(data)
    }
    
    public func close() async {}
}

public actor WebSocketTransport: Transport {
    private var task: Task<Void, Error>?
    private let messageStream: AsyncStream<String>
    private let messageContinuation: AsyncStream<String>.Continuation
    private var connection: URLSessionWebSocketTask?
    private var isClosed = false
    
    public init(url: URL) {
        var continuation: AsyncStream<String>.Continuation!
        self.messageStream = AsyncStream { continuation = $0 }
        self.messageContinuation = continuation
    }
    
    public func connect(to url: URL) async throws {
        let session = URLSession(configuration: .default)
        let wsTask = session.webSocketTask(with: url)
        self.connection = wsTask
        
        wsTask.resume()
        
        task = Task {
            while !isClosed {
                do {
                    let message = try await wsTask.receive()
                    switch message {
                    case .string(let text):
                        messageContinuation.yield(text)
                    case .data:
                        break
                    @unknown default:
                        break
                    }
                } catch {
                    messageContinuation.finish()
                    throw error
                }
            }
        }
    }
    
    public func read() async throws -> String? {
        for await message in messageStream {
            return message
        }
        return nil
    }
    
    public func write(_ message: String) async throws {
        guard let connection = connection else {
            throw KkrpcError.transportClosed
        }
        try await connection.send(.string(message))
    }
    
    public func close() async {
        isClosed = true
        task?.cancel()
        connection?.cancel(with: .normalClosure, reason: nil)
        messageContinuation.finish()
    }
}
