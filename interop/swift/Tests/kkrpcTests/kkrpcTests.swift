import XCTest
@testable import kkrpc

final class ProtocolTests: XCTestCase {
    func testGenerateUUID() {
        let uuid1 = generateUUID()
        let uuid2 = generateUUID()
        
        XCTAssertNotEqual(uuid1, uuid2)
        XCTAssertEqual(uuid1.split(separator: "-").count, 4)
    }
    
    func testEncodeDecodeMessage() throws {
        let payload: [String: Any] = [
            "id": "test-id",
            "type": "request",
            "method": "math.add",
            "args": [1, 2],
            "version": "json"
        ]
        
        let encoded = try encodeMessage(payload)
        XCTAssertTrue(encoded.hasSuffix("\n"))
        
        let decoded = try decodeMessage(String(encoded.dropLast()))
        XCTAssertEqual(decoded["id"] as? String, "test-id")
        XCTAssertEqual(decoded["type"] as? String, "request")
        XCTAssertEqual(decoded["method"] as? String, "math.add")
    }
    
    func testDecodeError() {
        let errorMap: [String: Any] = [
            "name": "ValidationError",
            "message": "Invalid input"
        ]
        
        let error = decodeError(errorMap)
        if case .rpcError(let name, let message) = error {
            XCTAssertEqual(name, "ValidationError")
            XCTAssertEqual(message, "Invalid input")
        } else {
            XCTFail("Expected rpcError")
        }
    }
}

final class StdioTransportTests: XCTestCase {
    func testStdioTransport() async throws {
        let inputPipe = Pipe()
        let outputPipe = Pipe()
        
        let transport = StdioTransport(
            input: inputPipe.fileHandleForReading,
            output: outputPipe.fileHandleForWriting
        )
        
        let testMessage = "Hello, World!"
        let data = (testMessage + "\n").data(using: .utf8)!
        
        try inputPipe.fileHandleForWriting.write(contentsOf: data)
        
        let read = try await transport.read()
        XCTAssertEqual(read, testMessage)
    }
}

final class ClientServerTests: XCTestCase {
    func testClientCall() async throws {
        let inputPipe = Pipe()
        let outputPipe = Pipe()
        
        let clientTransport = StdioTransport(
            input: outputPipe.fileHandleForReading,
            output: inputPipe.fileHandleForWriting
        )
        
        let api: [String: Any] = [
            "math": [
                "add": { (args: [Any]) -> Any in
                    guard let a = args[0] as? Int,
                          let b = args[1] as? Int else { return 0 }
                    return a + b
                } as Handler
            ]
        ]
        
        let serverTransport = StdioTransport(
            input: inputPipe.fileHandleForReading,
            output: outputPipe.fileHandleForWriting
        )
        
        let server = Server(transport: serverTransport, api: api)
        let client = Client(transport: clientTransport)
        
        let result = try await client.call(method: "math.add", args: [1, 2])
        
        if let intResult = result as? Int {
            XCTAssertEqual(intResult, 3)
        } else {
            XCTFail("Expected integer result")
        }
        
        await client.close()
        await server.close()
    }
}
