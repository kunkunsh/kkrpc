# kkrpc - SWIFT INTEROP

**Generated:** 2026-02-05
**Location:** interop/swift

## OVERVIEW

Swift client/server library for kkrpc JSON-mode interop. Modern Swift concurrency with async/await, supporting stdio and WebSocket transports.

## STRUCTURE

```
swift/
├── Sources/
│   └── kkrpc/
│       ├── Client.swift       # RPC client (actor)
│       ├── Server.swift       # RPC server (actor)
│       ├── Protocol.swift     # Message types, encoding
│       └── Transport.swift    # Transport protocol + implementations
├── Tests/
│   └── kkrpcTests/
│       └── kkrpcTests.swift   # Unit tests
├── Package.swift              # SPM manifest
└── README.md                  # Usage documentation
```

## KEY FILES

| File              | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `Client.swift`    | Client actor with call(), get(), set()                 |
| `Server.swift`    | Server actor with API dispatch                         |
| `Protocol.swift`  | encodeMessage(), decodeMessage(), UUID gen             |
| `Transport.swift` | Transport protocol, StdioTransport, WebSocketTransport |

## IMPLEMENTATION PATTERNS

### Transport Protocol

```swift
public protocol Transport {
    func read() async throws -> String?
    func write(_ message: String) async throws
    func close() async
}
```

### Client Usage

```swift
import kkrpc

let transport = StdioTransport(
    input: outputPipe.fileHandleForReading,
    output: inputPipe.fileHandleForWriting
)
let client = Client(transport: transport)
let result = try await client.call(method: "math.add", args: [1, 2])
```

### Server Usage

```swift
import kkrpc

let api: [String: Any] = [
    "math": [
        "add": { (args: [Any]) -> Any in
            (args[0] as! Int) + (args[1] as! Int)
        } as Handler
    ]
]

let transport = StdioTransport()
let server = Server(transport: transport, api: api)
RunLoop.main.run()
```

## CONVENTIONS

- **Naming**: CamelCase for types, methods; lowerCamelCase for variables
- **Concurrency**: async/await, actors for thread safety
- **Error handling**: throws/try for error propagation
- **Types**: Any for JSON values, Handler typealias for callbacks

## COMMANDS

```bash
# Build
swift build

# Run tests
swift test

# Generate Xcode project
swift package generate-xcodeproj
```

## NOTES

- Swift 5.9+ required
- Platforms: macOS 10.15+, iOS 13+, tvOS 13+, watchOS 6+
- No external dependencies (Foundation only)
- Callbacks encoded as `__callback__<id>` strings
- Compatible with kkrpc `serialization.version = "json"`

## TYPE ALIASES

```swift
public typealias Handler = ([Any]) -> Any
public typealias Callback = ([Any]) -> Void
```

## LIMITATIONS

Server handlers must use Handler signature:

```swift
// Valid
api.register("math.add") { args in
    (args[0] as! Int) + (args[1] as! Int)
}

// Invalid - wrong signature
api.register("math.add") { (a: Int, b: Int) -> Int in
    a + b
}
```
