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
                guard message["t"] as? String == "q",
                      let messageType = message["op"] as? String else { continue }
                
                switch messageType {
                case "call":
                    await handleRequest(message)
                case "get":
                    await handleGet(message)
                case "set":
                    await handleSet(message)
                case "new":
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

    private func setPath(_ path: [String], value: Any) throws {
        try setPath(path, value: value, in: &api)
    }

    private func setPath(_ path: [String], value: Any, in target: inout [String: Any]) throws {
        guard let key = path.first else {
            throw KkrpcError.rpcError(name: "MissingPath", message: "Missing path")
        }
        if path.count == 1 {
            target[key] = value
            return
        }
        guard var child = target[key] as? [String: Any] else {
            throw KkrpcError.rpcError(name: "TypeError", message: "Set target is not an object")
        }
        try setPath(Array(path.dropFirst()), value: value, in: &child)
        target[key] = child
    }
    
    private func convertInboundArg(_ arg: Any, requestId: String) -> Any {
        guard let envelope = arg as? [String: Any],
              let envelopeType = envelope[argEnvelopeTag] as? String else {
            return arg
        }
        if envelopeType == "value" {
            return envelope["v"] as Any
        }
        if envelopeType == "callback", let callbackId = envelope["id"] as? String {
            let callback: Callback = { [weak self] callbackArgs in
                Task {
                    await self?.sendCallback(requestId: requestId, callbackId: callbackId, args: callbackArgs)
                }
            }
            return callback
        }
        return arg
    }

    private func convertInboundArgs(args: [Any], requestId: String) -> [Any] {
        var processed: [Any] = []
        for arg in args {
            processed.append(convertInboundArg(arg, requestId: requestId))
        }
        return processed
    }
    
    private func sendCallback(requestId: String, callbackId: String, args: [Any]) async {
        let payload: [String: Any] = [
            "t": "cb",
            "id": callbackId,
            "a": args
        ]
        guard let message = try? encodeMessage(payload) else { return }
        try? await transport.write(message)
    }
    
    private func sendResponse(requestId: String, result: Any) async {
        let payload: [String: Any] = [
            "t": "r",
            "id": requestId,
            "v": result
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
            "t": "r",
            "id": requestId,
            "e": [
                "n": errorName,
                "m": errorMessage
            ]
        ]
        guard let message = try? encodeMessage(payload) else { return }
        try? await transport.write(message)
    }
    
    private func handleRequest(_ message: [String: Any]) async {
        guard let requestId = message["id"] as? String else { return }
        let argsRaw = message["a"] as? [Any] ?? []
        
        let path = message["p"] as? [String] ?? []
        
        do {
            let resolved = try resolvePath(path)
            guard let callable = resolved as? Handler else {
                throw KkrpcError.rpcError(name: "TypeError", message: "Method not callable")
            }
            let result = callable(convertInboundArgs(args: argsRaw, requestId: requestId))
            await sendResponse(requestId: requestId, result: result)
        } catch {
            await sendError(requestId: requestId, error: error)
        }
    }
    
    private func handleGet(_ message: [String: Any]) async {
        guard let requestId = message["id"] as? String else { return }
        guard let pathRaw = message["p"] as? [Any] else {
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
        guard let pathRaw = message["p"] as? [Any], !pathRaw.isEmpty else {
            await sendError(requestId: requestId, error: KkrpcError.rpcError(name: "MissingPath", message: "Missing path"))
            return
        }
        let path = pathRaw.compactMap { $0 as? String }
        guard !path.isEmpty else {
            await sendError(requestId: requestId, error: KkrpcError.rpcError(name: "MissingPath", message: "Missing path"))
            return
        }
        
        do {
            try setPath(path, value: message["v"] ?? NSNull())
            await sendResponse(requestId: requestId, result: true)
        } catch {
            await sendError(requestId: requestId, error: error)
        }
    }
    
    private func handleConstruct(_ message: [String: Any]) async {
        guard let requestId = message["id"] as? String else { return }
        let argsRaw = message["a"] as? [Any] ?? []
        
        let path = message["p"] as? [String] ?? []
        
        do {
            let resolved = try resolvePath(path)
            guard let constructor = resolved as? Handler else {
                throw KkrpcError.rpcError(name: "TypeError", message: "Constructor not callable")
            }
            let result = constructor(convertInboundArgs(args: argsRaw, requestId: requestId))
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
