import Foundation

public typealias Handler = ([Any]) -> Any

public actor Server {
    private let transport: Transport
    private var api: [String: Any]
    private var readTask: Task<Void, Never>?
    
    public init(transport: Transport, api: [String: Any]) {
        self.transport = transport
        self.api = api
        self.readTask = Task {
            await self.readLoop()
        }
    }
    
    deinit {
        readTask?.cancel()
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
                case "request":
                    await handleRequest(message)
                case "get":
                    await handleGet(message)
                case "set":
                    await handleSet(message)
                case "construct":
                    await handleConstruct(message)
                default:
                    break
                }
            } catch {
                break
            }
        }
    }
    
    private func resolvePath(_ path: [String]) throws -> Any {
        var target: Any = api
        for part in path {
            guard let obj = target as? [String: Any],
                  let value = obj[part] else {
                throw KkrpcError.rpcError(name: "PathError", message: "Path not found: \(path.joined(separator: "."))")
            }
            target = value
        }
        return target
    }
    
    private func wrapCallbacks(args: [Any], requestId: String) -> [Any] {
        var processed: [Any] = []
        for arg in args {
            if let text = arg as? String, text.hasPrefix(callbackPrefix) {
                let callbackId = String(text.dropFirst(callbackPrefix.count))
                let callback: Callback = { [weak self] callbackArgs in
                    Task {
                        await self?.sendCallback(requestId: requestId, callbackId: callbackId, args: callbackArgs)
                    }
                }
                processed.append(callback)
            } else {
                processed.append(arg)
            }
        }
        return processed
    }
    
    private func sendCallback(requestId: String, callbackId: String, args: [Any]) async {
        let payload: [String: Any] = [
            "id": requestId,
            "method": callbackId,
            "args": args,
            "type": "callback",
            "version": "json"
        ]
        guard let message = try? encodeMessage(payload) else { return }
        try? await transport.write(message)
    }
    
    private func sendResponse(requestId: String, result: Any) async {
        let payload: [String: Any] = [
            "id": requestId,
            "method": "",
            "args": ["result": result],
            "type": "response",
            "version": "json"
        ]
        guard let message = try? encodeMessage(payload) else { return }
        try? await transport.write(message)
    }
    
    private func sendError(requestId: String, error: Error) async {
        let errorMessage: String
        let errorName: String
        if let rpcError = error as? KkrpcError {
            switch rpcError {
            case .rpcError(let name, let message):
                errorName = name
                errorMessage = message
            default:
                errorName = "Error"
                errorMessage = String(describing: error)
            }
        } else {
            errorName = "Error"
            errorMessage = error.localizedDescription
        }
        
        let payload: [String: Any] = [
            "id": requestId,
            "method": "",
            "args": [
                "error": [
                    "name": errorName,
                    "message": errorMessage
                ]
            ],
            "type": "response",
            "version": "json"
        ]
        guard let message = try? encodeMessage(payload) else { return }
        try? await transport.write(message)
    }
    
    private func handleRequest(_ message: [String: Any]) async {
        guard let requestId = message["id"] as? String else { return }
        let method = message["method"] as? String ?? ""
        let argsRaw = message["args"] as? [Any] ?? []
        
        let path = method.isEmpty ? [] : method.split(separator: ".").map(String.init)
        
        do {
            let resolved = try resolvePath(path)
            guard let callable = resolved as? Handler else {
                throw KkrpcError.rpcError(name: "TypeError", message: "Method not callable")
            }
            let result = callable(wrapCallbacks(args: argsRaw, requestId: requestId))
            await sendResponse(requestId: requestId, result: result)
        } catch {
            await sendError(requestId: requestId, error: error)
        }
    }
    
    private func handleGet(_ message: [String: Any]) async {
        guard let requestId = message["id"] as? String else { return }
        guard let pathRaw = message["path"] as? [Any] else {
            await sendError(requestId: requestId, error: KkrpcError.rpcError(name: "MissingPath", message: "Missing path"))
            return
        }
        let path = pathRaw.compactMap { $0 as? String }
        
        do {
            let result = try resolvePath(path)
            await sendResponse(requestId: requestId, result: result)
        } catch {
            await sendError(requestId: requestId, error: error)
        }
    }
    
    private func handleSet(_ message: [String: Any]) async {
        guard let requestId = message["id"] as? String else { return }
        guard let pathRaw = message["path"] as? [Any], !pathRaw.isEmpty else {
            await sendError(requestId: requestId, error: KkrpcError.rpcError(name: "MissingPath", message: "Missing path"))
            return
        }
        let path = pathRaw.compactMap { $0 as? String }
        guard !path.isEmpty else {
            await sendError(requestId: requestId, error: KkrpcError.rpcError(name: "MissingPath", message: "Missing path"))
            return
        }
        
        do {
            let parent = try resolvePath(Array(path.dropLast()))
            guard var parentMap = parent as? [String: Any] else {
                throw KkrpcError.rpcError(name: "TypeError", message: "Set target is not an object")
            }
            parentMap[path.last!] = message["value"]
            await sendResponse(requestId: requestId, result: true)
        } catch {
            await sendError(requestId: requestId, error: error)
        }
    }
    
    private func handleConstruct(_ message: [String: Any]) async {
        guard let requestId = message["id"] as? String else { return }
        let method = message["method"] as? String ?? ""
        let argsRaw = message["args"] as? [Any] ?? []
        
        let path = method.isEmpty ? [] : method.split(separator: ".").map(String.init)
        
        do {
            let resolved = try resolvePath(path)
            guard let constructor = resolved as? Handler else {
                throw KkrpcError.rpcError(name: "TypeError", message: "Constructor not callable")
            }
            let result = constructor(wrapCallbacks(args: argsRaw, requestId: requestId))
            await sendResponse(requestId: requestId, result: result)
        } catch {
            await sendError(requestId: requestId, error: error)
        }
    }
    
    public func close() async {
        readTask?.cancel()
        await transport.close()
    }
}
