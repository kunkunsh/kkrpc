import Foundation

public typealias Callback = ([Any]) -> Void

public struct ResponsePayload {
    public let result: Any?
    public let error: KkrpcError?
    
    public init(result: Any? = nil, error: KkrpcError? = nil) {
        self.result = result
        self.error = error
    }
}

public actor Client {
    private let transport: Transport
    private var pending: [String: CheckedContinuation<ResponsePayload, Never>] = [:]
    private var callbacks: [String: Callback] = [:]
    private var readTask: Task<Void, Never>?
    
    public init(transport: Transport) {
        self.transport = transport
        self.readTask = Task {
            await self.readLoop()
        }
    }
    
    deinit {
        readTask?.cancel()
    }
    
    public func call(method: String, args: [Any] = []) async throws -> Any? {
        return try await sendRequest(op: "call", args: args, path: method.split(separator: ".").map(String.init), value: nil)
    }
    
    public func get(path: [String]) async throws -> Any? {
        return try await sendRequest(op: "get", args: [], path: path, value: nil)
    }
    
    public func set(path: [String], value: Any) async throws -> Any? {
        return try await sendRequest(op: "set", args: [], path: path, value: value)
    }
    
    private func sendRequest(
        op: String,
        args: [Any],
        path: [String],
        value: Any?
    ) async throws -> Any? {
        let requestId = generateUUID()
        
        var processedArgs: [Any] = []
        
        for arg in args {
            if let cb = arg as? Callback {
                let callbackId = generateUUID()
                callbacks[callbackId] = cb
                processedArgs.append([argEnvelopeTag: "callback", "id": callbackId])
            } else {
                processedArgs.append(arg)
            }
        }
        
        var payload: [String: Any] = [
            "t": "q",
            "id": requestId,
            "op": op,
            "p": path
        ]
        
        if !processedArgs.isEmpty {
            payload["a"] = processedArgs
        }
        if let value = value {
            payload["v"] = value
        }
        
        let message = try encodeMessage(payload)
        let transport = self.transport
        
        let response = await withCheckedContinuation { continuation in
            pending[requestId] = continuation
            Task {
                do {
                    try await transport.write(message)
                } catch {
                    self.handleWriteFailure(requestId: requestId, error: error)
                }
            }
        }
        if let error = response.error {
            throw error
        }
        return response.result
    }

    private func handleWriteFailure(requestId: String, error: Error) {
        guard let continuation = pending.removeValue(forKey: requestId) else {
            return
        }
        let rpcError = error as? KkrpcError
            ?? KkrpcError.rpcError(name: "Error", message: String(describing: error))
        continuation.resume(returning: ResponsePayload(error: rpcError))
    }
    
    private func readLoop() async {
        while !Task.isCancelled {
            do {
                guard let line = try await transport.read() else {
                    break
                }
                await accept(line)
            } catch {
                break
            }
        }
    }
    
    /// Handle one frame that somebody else read.
    ///
    /// Exists for ``Channel``, which owns a single read loop over a transport
    /// both halves share; without it a `Client` and a `Server` on one transport
    /// race for every frame. A frame that is not a response or a callback is
    /// ignored here, exactly as the loop above ignores it.
    public func accept(_ line: String) async {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard let message = try? decodeMessage(trimmed) else { return }
        guard let messageType = message["t"] as? String else { return }

        switch messageType {
        case "r":
            await handleResponse(message)
        case "cb":
            await handleCallback(message)
        default:
            break
        }
    }

    private func handleResponse(_ message: [String: Any]) async {
        guard let requestId = message["id"] as? String,
              let continuation = pending.removeValue(forKey: requestId) else {
            return
        }
        
        if let errorValue = message["e"] {
            let error = decodeError(errorValue)
            continuation.resume(returning: ResponsePayload(error: error))
        } else {
            continuation.resume(returning: ResponsePayload(result: message["v"]))
        }
    }
    
    private func handleCallback(_ message: [String: Any]) async {
        guard let callbackId = message["id"] as? String,
              let callback = callbacks[callbackId] else {
            return
        }
        
        let args = (message["a"] as? [Any] ?? []).map(decodeArgument)
        callback(args)
    }
    
    public func close() async {
        readTask?.cancel()
        await transport.close()
    }
}
