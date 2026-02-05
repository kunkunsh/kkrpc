import Foundation

public func generateUUID() -> String {
    let parts = (0..<4).map { _ in
        String(format: "%llx", UInt64.random(in: 0..<UInt64.max))
    }
    return parts.joined(separator: "-")
}

public func encodeMessage(_ payload: [String: Any]) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: payload)
    guard let json = String(data: data, encoding: .utf8) else {
        throw KkrpcError.encodingError
    }
    return json + "\n"
}

public func decodeMessage(_ raw: String) throws -> [String: Any] {
    guard let data = raw.data(using: .utf8) else {
        throw KkrpcError.decodingError
    }
    let object = try JSONSerialization.jsonObject(with: data)
    guard let dict = object as? [String: Any] else {
        throw KkrpcError.decodingError
    }
    return dict
}

public func decodeError(_ value: Any) -> KkrpcError {
    guard let errorMap = value as? [String: Any] else {
        return KkrpcError.rpcError(name: "Error", message: String(describing: value))
    }
    let name = errorMap["name"] as? String ?? "Error"
    let message = errorMap["message"] as? String ?? "Unknown error"
    return KkrpcError.rpcError(name: name, message: message)
}
