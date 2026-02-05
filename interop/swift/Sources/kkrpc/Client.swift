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
        return try await sendRequest(type: "request", method: method, args: args, path: nil, value: nil)
    }
    
    public func get(path: [String]) async throws -> Any? {
        return try await sendRequest(type: "get", method: nil, args: [], path: path, value: nil)
    }
    
    public func set(path: [String], value: Any) async throws -> Any? {
        return try await sendRequest(type: "set", method: nil, args: [], path: path, value: value)
    }
    
    private func sendRequest(
        type: String,
        method: String?,
        args: [Any],
        path: [String]?,
        value: Any?
    ) async throws -> Any? {
        let requestId = generateUUID()
        
        var processedArgs: [Any] = []
        var callbackIds: [String] = []
        
        for arg in args {
            if let cb = arg as? Callback {
                let callbackId = generateUUID()
                callbacks[callbackId] = cb
                callbackIds.append(callbackId)
                processedArgs.append("\(callbackPrefix)\(callbackId)")
            } else {
                processedArgs.append(arg)
            }
        }
        
        var payload: [String: Any] = [
            "id": requestId,
            "type": type,
            "version": "json"
        ]
        
        if let method = method {
            payload["method"] = method
        }
        if !processedArgs.isEmpty {
            payload["args"] = processedArgs
        }
        if !callbackIds.isEmpty {
            payload["callbackIds"] = callbackIds
        }
        if let path = path {
            payload["path"] = path
        }
        if let value = value {
            payload["value"] = value
        }
        
        let message = try encodeMessage(payload)
        try await transport.write(message)
        
        return await withCheckedContinuation { continuation in
            pending[requestId] = continuation
        }.result
    }
    
    private func readLoop() async {
        while !Task.isCancelled {
            do {
                guard let line = try await transport.read() else {
                    break
                }
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { continue }
                
                guard let message = try? decodeMessage(trimmed) else { continue }
                guard let messageType = message["type"] as? String else { continue }
                
                switch messageType {
                case "response":
                    await handleResponse(message)
                case "callback":
                    await handleCallback(message)
                default:
                    break
                }
            } catch {
                break
            }
        }
    }
    
    private func handleResponse(_ message: [String: Any]) async {
        guard let requestId = message["id"] as? String,
              let continuation = pending.removeValue(forKey: requestId) else {
            return
        }
        
        guard let args = message["args"] as? [String: Any] else {
            continuation.resume(returning: ResponsePayload(result: nil))
            return
        }
        
        if let errorValue = args["error"] {
            let error = decodeError(errorValue)
            continuation.resume(returning: ResponsePayload(error: error))
        } else {
            continuation.resume(returning: ResponsePayload(result: args["result"]))
        }
    }
    
    private func handleCallback(_ message: [String: Any]) async {
        guard let callbackId = message["method"] as? String,
              let callback = callbacks[callbackId] else {
            return
        }
        
        let args = message["args"] as? [Any] ?? []
        callback(args)
    }
    
    public func close() async {
        readTask?.cancel()
        await transport.close()
    }
}
