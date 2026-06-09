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
            "t": "q",
            "id": "test-id",
            "op": "call",
            "p": ["math", "add"],
            "a": [1, 2]
        ]
        
        let encoded = try encodeMessage(payload)
        XCTAssertTrue(encoded.hasSuffix("\n"))
        
        let decoded = try decodeMessage(String(encoded.dropLast()))
        XCTAssertEqual(decoded["id"] as? String, "test-id")
        XCTAssertEqual(decoded["t"] as? String, "q")
        XCTAssertEqual(decoded["op"] as? String, "call")
        XCTAssertEqual(decoded["p"] as? [String], ["math", "add"])
    }
    
    func testDecodeError() {
        let errorMap: [String: Any] = [
            "n": "ValidationError",
            "m": "Invalid input"
        ]
        
        let error = decodeError(errorMap)
        if case .rpcError(let name, let message) = error {
            XCTAssertEqual(name, "ValidationError")
            XCTAssertEqual(message, "Invalid input")
        } else {
            XCTFail("Expected rpcError")
        }
    }

    func testDecodeValueEnvelopeArgument() {
        let decoded = decodeArgument([
            argEnvelopeTag: "value",
            "v": "payload"
        ])

        XCTAssertEqual(decoded as? String, "payload")
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

    func testServerUnwrapsStableValueEnvelopeArgs() async throws {
        let inputPipe = Pipe()
        let outputPipe = Pipe()

        let api: [String: Any] = [
            "echo": { (args: [Any]) -> Any in
                args[0]
            } as Handler
        ]

        let serverTransport = StdioTransport(
            input: inputPipe.fileHandleForReading,
            output: outputPipe.fileHandleForWriting
        )
        let server = Server(transport: serverTransport, api: api)

        let request = try encodeMessage([
            "t": "q",
            "id": "value-envelope",
            "op": "call",
            "p": ["echo"],
            "a": [[argEnvelopeTag: "value", "v": "payload"]]
        ])
        try inputPipe.fileHandleForWriting.write(contentsOf: request.data(using: .utf8)!)

        let responseData = outputPipe.fileHandleForReading.availableData
        let response = String(data: responseData, encoding: .utf8) ?? ""
        let decoded = try decodeMessage(response.trimmingCharacters(in: .whitespacesAndNewlines))

        XCTAssertEqual(decoded["v"] as? String, "payload")
        await server.close()
    }
}
