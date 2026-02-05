# kkrpc-interop (Swift)

Swift client/server library for kkrpc JSON-mode interop. This package implements the kkrpc message protocol using JSON only, enabling cross-language RPC between Swift and TypeScript/JavaScript.

## Features

- JSON-mode request/response compatible with kkrpc `serialization.version = "json"`
- `stdio` and `ws` transports with a shared `Transport` protocol
- Callback support using `__callback__<id>` tokens
- Property access (get/set) for remote object manipulation
- Modern Swift concurrency with async/await

## Requirements

- Swift 5.9+
- macOS 10.15+, iOS 13+, tvOS 13+, watchOS 6+

## Installation

### Swift Package Manager

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/kunkunsh/kkrpc.git", from: "0.6.0")
]
```

Or in Xcode: File → Add Package Dependencies → Enter repository URL

### From this repository

```bash
cd interop/swift
swift test
```

## Usage

### Stdio client

```swift
import kkrpc
import Foundation

// Spawn a server process
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/bun")
process.arguments = ["interop/node/server.ts"]

let inputPipe = Pipe()
let outputPipe = Pipe()
process.standardInput = inputPipe
process.standardOutput = outputPipe

try process.run()

// Create transport and client
let transport = StdioTransport(
    input: outputPipe.fileHandleForReading,
    output: inputPipe.fileHandleForWriting
)
let client = Client(transport: transport)

// Call remote method
let result = try await client.call(method: "math.add", args: [1, 2])
print(result) // 3

await client.close()
```

### WebSocket client

```swift
import kkrpc

let transport = WebSocketTransport()
try await transport.connect(to: URL(string: "ws://localhost:8789")!)
let client = Client(transport: transport)

let result = try await client.call(
    method: "echo",
    args: [["hello": "kkrpc"]]
)
print(result)

await client.close()
```

### Server

```swift
import kkrpc

let api: [String: Any] = [
    "math": [
        "add": { (args: [Any]) -> Any in
            guard let a = args[0] as? Int,
                  let b = args[1] as? Int else { return 0 }
            return a + b
        } as Handler
    ]
]

let transport = StdioTransport()
let server = Server(transport: transport, api: api)

// Keep server running
RunLoop.main.run()
```

### Callbacks

```swift
// Client sending a callback
var receivedCallback = false
let callback: Callback = { args in
    print("Callback received: \(args)")
    receivedCallback = true
}

let result = try await client.call(
    method: "process.withCallback",
    args: [callback, "data"]
)

// Server invoking the callback
let api: [String: Any] = [
    "process": [
        "withCallback": { (args: [Any]) -> Any in
            if let callback = args[0] as? Callback {
                callback(["progress", 50])
            }
            return "done"
        } as Handler
    ]
]
```

### Property Access

```swift
// Get property
let counter = try await client.get(path: ["counter"])

// Set property
try await client.set(path: ["settings", "theme"], value: "dark")
```

## Tests

```bash
cd interop/swift
swift test
```

## How it works with kkrpc

- **Message format**: JSON objects with `id`, `method`, `args`, `type`, `version`
- **Line-delimited transport**: each JSON message ends with `\n`
- **Callbacks**: function arguments are encoded as `__callback__<id>` and dispatched via `type = "callback"`
- **Adapters**: `Transport` is the common protocol for `StdioTransport` and `WebSocketTransport`

Set kkrpc JS clients/servers to `serialization.version = "json"` for interop.

## Architecture

### Transport Protocol

```swift
public protocol Transport {
    func read() async throws -> String?
    func write(_ message: String) async throws
    func close() async
}
```

### Client

The `Client` actor handles:

- Sending requests with unique IDs
- Managing pending requests
- Handling callbacks
- Background read loop for responses

### Server

The `Server` actor handles:

- Registering API methods
- Dispatching incoming requests
- Wrapping callback arguments
- Property get/set operations

## Limitations

### Type Safety

Due to the dynamic nature of JSON-RPC, arguments and return values are `Any`. You'll need to cast them:

```swift
let result = try await client.call(method: "math.add", args: [1, 2])
if let intResult = result as? Int {
    print(intResult)
}
```

### Function Signatures

Server handlers must conform to the `Handler` typealias: `([Any]) -> Any`

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

## License

Apache-2.0
