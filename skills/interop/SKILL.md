---
name: kkrpc-interop
description: Implement kkrpc client/server in any programming language to communicate with TypeScript kkrpc endpoints. Covers protocol, message formats, transports, and reference implementations in Go, Python, Rust, and Swift.
version: 1.0.0
license: MIT
metadata:
  author: kkrpc
  domain: cross-language-rpc
  tags:
    - rpc
    - interop
    - protocol
    - go
    - python
    - rust
    - swift
compatibility: Works with any language that can parse JSON and implement stdio/WebSocket transports
---

# kkrpc Language Interop

Implement kkrpc client/server in any programming language to communicate with TypeScript kkrpc endpoints.

## Overview

kkrpc is a TypeScript-first bidirectional RPC library. This skill teaches you how to implement language interop clients/servers in any programming language to communicate with kkrpc TypeScript endpoints.

### Supported Reference Implementations

| Language | Location                       | Transports       |
| -------- | ------------------------------ | ---------------- |
| Go       | `interop/go/kkrpc/`            | stdio, WebSocket |
| Python   | `interop/python/kkrpc/`        | stdio, WebSocket |
| Rust     | `interop/rust/src/`            | stdio, WebSocket |
| Swift    | `interop/swift/Sources/kkrpc/` | stdio, WebSocket |

---

## Core Protocol

### Message Format (JSON-only for interop)

All messages are **line-delimited JSON** (newline-terminated UTF-8 strings).

```json
{
  "id": "uuid-string",
  "type": "request|response|callback|get|set|construct",
  "version": "json",
  "method": "optional.method.path",
  "args": [...],
  "path": ["optional", "property", "path"],
  "value": "optional-value-for-set",
  "callbackIds": ["optional-callback-ids"]
}
```

### Message Types

| Type        | Purpose                  | Required Fields                     |
| ----------- | ------------------------ | ----------------------------------- |
| `request`   | Remote method call       | `id`, `method`, `args`              |
| `response`  | Return value or error    | `id`, `args.result` or `args.error` |
| `callback`  | Invoke callback function | `method` (callback id), `args`      |
| `get`       | Property read            | `id`, `path`                        |
| `set`       | Property write           | `id`, `path`, `value`               |
| `construct` | Constructor call         | `id`, `method`, `args`              |

### Request Message Example

```json
{
	"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	"type": "request",
	"version": "json",
	"method": "math.add",
	"args": [1, 2],
	"callbackIds": []
}
```

### Response Message Example (Success)

```json
{
	"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	"type": "response",
	"version": "json",
	"method": "",
	"args": {
		"result": 3
	}
}
```

### Response Message Example (Error)

```json
{
	"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	"type": "response",
	"version": "json",
	"method": "",
	"args": {
		"error": {
			"name": "Error",
			"message": "Division by zero"
		}
	}
}
```

### Callback Encoding

Functions are encoded as string markers: `__callback__<uuid>`

When sending a callback:

1. Generate a UUID for the callback
2. Store the callable with that ID
3. Send `"__callback__<uuid>"` as the argument
4. Include the callback ID in `callbackIds` array

When receiving a callback marker:

1. Create a wrapper function that sends a `callback` message
2. The callback message uses the ID as the `method` field
3. Invoke your stored callable when `type: "callback"` arrives

---

## UUID Generation

Format: 4 hex parts joined with `-` (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)

### Go

```go
func GenerateUUID() string {
    parts := make([]string, 0, 4)
    for i := 0; i < 4; i++ {
        parts = append(parts, fmt.Sprintf("%x", rand.Int63()))
    }
    return fmt.Sprintf("%s-%s-%s-%s", parts[0], parts[1], parts[2], parts[3])
}
```

### Python

```python
def generate_uuid() -> str:
    return "-".join(f"{random.getrandbits(53):x}" for _ in range(4))
```

### Rust

```rust
pub fn generate_uuid() -> String {
    let mut rng = rand::thread_rng();
    let parts: Vec<String> = (0..4)
        .map(|_| format!("{:x}", rng.gen::<u64>()))
        .collect();
    parts.join("-")
}
```

### Swift

```swift
public func generateUUID() -> String {
    let parts = (0..<4).map { _ in
        String(format: "%llx", UInt64.random(in: 0..<UInt64.max))
    }
    return parts.joined(separator: "-")
}
```

---

## Transport Layer

### Transport Interface

Every transport must implement:

```
read() -> string?   // Read one line/message, null/None if closed
write(message)      // Write message (with newline for stdio)
close()             // Close connection
```

### Stdio Transport

- Read lines from input stream (blocking)
- Write messages to output stream with `\n` suffix
- Flush immediately after writing

### WebSocket Transport

- Send/receive text frames containing JSON
- Handle connection handshake (RFC6455)
- Mask client-to-server frames
- Read frames and extract payload

### Language-Specific Transport Patterns

**Go (Interface)**:

```go
type Transport interface {
    Read() (string, error)
    Write(message string) error
    Close() error
}
```

**Python (ABC)**:

```python
class Transport(ABC):
    @abstractmethod
    def read(self) -> Optional[str]: ...
    @abstractmethod
    def write(self, message: str) -> None: ...
    @abstractmethod
    def close(self) -> None: ...
```

**Rust (Trait)**:

```rust
pub trait Transport: Send + Sync {
    fn read(&self) -> Option<String>;
    fn write(&self, message: &str) -> Result<(), String>;
    fn close(&self);
}
```

**Swift (Protocol)**:

```swift
public protocol Transport {
    func read() async throws -> String?
    func write(_ message: String) async throws
    func close() async
}
```

---

## Client Implementation

### Client Responsibilities

1. **Request Management**: Track pending requests by ID
2. **Callback Storage**: Store callbacks by ID
3. **Response Handling**: Route responses to waiting callers
4. **Read Loop**: Continuously read messages in background

### Client Methods

| Method                       | Purpose               |
| ---------------------------- | --------------------- |
| `call(method, ...args)`      | Invoke remote method  |
| `get(path[])`                | Read remote property  |
| `set(path[], value)`         | Write remote property |
| `construct(method, ...args)` | Call constructor      |

### Client Request Flow

```
1. Generate request ID
2. Create pending request entry (ID -> Promise/Channel)
3. Process arguments (encode callbacks to __callback__<id>)
4. Build message payload
5. Serialize to JSON + newline
6. Write to transport
7. Block/wait for response
8. Return result or throw error
```

### Callback Encoding Flow

```
For each argument:
  If callable:
    - Generate callback ID
    - Store callable with ID
    - Replace with "__callback__<id>"
    - Add ID to callbackIds array
  Else:
    - Pass through as-is
```

### Response Handling

```
On receive message:
  If type == "response":
    - Look up pending request by ID
    - If args has "error", reject/throw
    - Else resolve with args["result"]
    - Remove from pending
  If type == "callback":
    - Get callback ID from "method" field
    - Look up stored callback
    - Invoke with "args" array
```

---

## Server Implementation

### Server Responsibilities

1. **API Registration**: Store method handlers by path
2. **Request Dispatch**: Route requests to handlers
3. **Path Resolution**: Resolve dot-notation paths (e.g., "math.add")
4. **Callback Wrapping**: Convert callback markers to callable wrappers
5. **Response Sending**: Send results or errors back

### Message Handlers

| Type        | Handler Logic                                                    |
| ----------- | ---------------------------------------------------------------- |
| `request`   | Resolve path, get handler, wrap callbacks, invoke, send response |
| `get`       | Resolve path, return value at path                               |
| `set`       | Resolve parent path, set property, return true                   |
| `construct` | Like request, but for constructors                               |

### Path Resolution

Split method by `.` and traverse API object:

```
api = {
  "math": {
    "add": (a, b) => a + b
  }
}

Path: ["math", "add"] -> resolves to function
```

### Callback Wrapping

When receiving `__callback__<id>` in arguments:

```
Create wrapper function that:
  - Sends message with:
    - type: "callback"
    - method: <callback-id>
    - args: wrapper arguments
    - id: original request ID
  - Writes to transport
```

### Error Response Format

```json
{
	"id": "request-id",
	"type": "response",
	"version": "json",
	"method": "",
	"args": {
		"error": {
			"name": "ErrorClassName",
			"message": "Error description"
		}
	}
}
```

---

## Implementation Patterns by Language

### Go Patterns

```go
// Client struct
type Client struct {
    transport Transport
    pending   map[string]chan responsePayload
    callbacks map[string]Callback
    mu        sync.Mutex
}

// Handler signature
api.Register("math.add", func(args []any) any {
    return args[0].(float64) + args[1].(float64)
})

// Response channel pattern
responseCh := make(chan responsePayload, 1)
pending[requestID] = responseCh
// ... send request ...
response := <-responseCh
```

### Python Patterns

```python
# Threading-based client
class RpcClient:
    def __init__(self, transport: Transport):
        self._transport = transport
        self._pending: Dict[str, PendingRequest] = {}
        self._callbacks: Dict[str, Callable] = {}
        self._lock = threading.Lock()
        self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
        self._reader_thread.start()

# Queue-based response waiting
pending = PendingRequest(queue=queue.Queue(maxsize=1))
self._pending[request_id] = pending
# ... send request ...
response = pending.queue.get()
```

### Rust Patterns

```rust
// Arc + Mutex for shared state
pub struct Client {
    transport: Arc<dyn Transport>,
    pending: Arc<Mutex<HashMap<String, Sender<ResponsePayload>>>>,
    callbacks: Arc<Mutex<HashMap<String, Callback>>>,
}

// Arg enum for value vs callback
pub enum Arg {
    Value(Value),
    Callback(Callback),
}

// mpsc channel for responses
let (sender, receiver) = mpsc::channel();
pending.lock().unwrap().insert(request_id, sender);
let response = receiver.recv().expect("response");
```

### Swift Patterns

```swift
// Actor for thread-safe state
public actor Client {
    private var pending: [String: CheckedContinuation<ResponsePayload, Never>] = [:]
    private var callbacks: [String: Callback] = [:]
}

// Async/await with continuation
return await withCheckedContinuation { continuation in
    pending[requestId] = continuation
}

// Handler typealias
public typealias Handler = ([Any]) -> Any
public typealias Callback = ([Any]) -> Void
```

---

## TypeScript Compatibility

### Required kkrpc Settings

When creating RPCChannel on TypeScript side for interop:

```typescript
const rpc = new RPCChannel(io, {
	expose: api,
	serialization: { version: "json" } // REQUIRED for interop
})
```

### SuperJSON Note

kkrpc defaults to SuperJSON which supports Date, Map, Set, BigInt, Uint8Array.
Interop implementations only support JSON - complex types will not work.

### Supported Types

| Type       | JSON Support                |
| ---------- | --------------------------- |
| Number     | ✓ (float64)                 |
| String     | ✓                           |
| Boolean    | ✓                           |
| null       | ✓                           |
| Array      | ✓                           |
| Object     | ✓                           |
| Date       | ✗ (use ISO string)          |
| BigInt     | ✗ (use string)              |
| Uint8Array | ✗ (use base64)              |
| Map/Set    | ✗ (convert to object/array) |

---

## Testing Strategy

### Test Against Reference Server

Use the Node.js test server: `interop/node/server.ts`

```bash
# Terminal 1: Start server
bun interop/node/server.ts

# Terminal 2: Run your client
your-client-app
```

### API to Test Against

```typescript
const api = {
    math: {
        add(a: number, b: number): number
    },
    echo<T>(value: T): T,
    withCallback(value: string, cb: (payload: string) => void): string,
    counter: number,
    settings: {
        theme: string,
        notifications: { enabled: boolean }
    }
}
```

### Test Cases

1. **Basic call**: `math.add(1, 2)` → `3`
2. **Echo**: `echo({"hello": "world"})` → same object
3. **Callback**: `withCallback("test", cb)` → cb invoked with "callback:test"
4. **Property get**: `await api.counter` → `42`
5. **Property get nested**: `await api.settings.theme` → `"light"`
6. **Property set**: `api.counter = 100` → success
7. **Error handling**: Call non-existent method → throws error

---

## Common Pitfalls

### 1. Missing Newlines

Always terminate JSON messages with `\n` for stdio transport.

### 2. JSON Number Precision

JSON numbers are float64. Large integers may lose precision.

### 3. Callback Memory Leaks

Clean up callback entries after they're invoked or when connection closes.

### 4. Path Resolution

Method names use dot-notation: `"math.add"` → `api["math"]["add"]`

### 5. Thread Safety

Multiple concurrent requests require proper synchronization:

- Go: sync.Mutex
- Python: threading.Lock
- Rust: Arc<Mutex<>>
- Swift: Actor

### 6. Error Propagation

Always include both `name` and `message` in error responses.

---

## Step-by-Step Implementation Guide

### Phase 1: Protocol Layer

1. Implement UUID generator (4 hex parts)
2. Implement JSON encode/decode with newline handling
3. Define error types

### Phase 2: Transport Layer

1. Define Transport interface/trait/ABC
2. Implement StdioTransport
3. (Optional) Implement WebSocketTransport

### Phase 3: Client

1. Create Client struct/class
2. Implement request ID tracking (pending map)
3. Implement callback storage
4. Implement read loop (background thread/task)
5. Implement `call()` method
6. Implement response routing
7. Implement callback invocation

### Phase 4: Server

1. Create Server struct/class
2. Implement API registration
3. Implement read loop
4. Implement message dispatch (switch on type)
5. Implement path resolution
6. Implement callback wrapping
7. Implement request handler
8. Implement get/set handlers

### Phase 5: Testing

1. Test against `interop/node/server.ts`
2. Test callbacks
3. Test property access
4. Test error handling
5. Test concurrent requests

---

## Example: Minimal Implementation Template

```python
# Minimal Python implementation template
import json
import random
import threading
import queue
from typing import Dict, Any, Optional, Callable, List

CALLBACK_PREFIX = "__callback__"

def generate_uuid() -> str:
    return "-".join(f"{random.getrandbits(53):x}" for _ in range(4))

def encode_message(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"

def decode_message(message: str) -> Dict[str, Any]:
    return json.loads(message)

class Transport:
    def read(self) -> Optional[str]: raise NotImplementedError
    def write(self, message: str) -> None: raise NotImplementedError
    def close(self) -> None: raise NotImplementedError

class RpcClient:
    def __init__(self, transport: Transport):
        self._transport = transport
        self._pending: Dict[str, queue.Queue] = {}
        self._callbacks: Dict[str, Callable] = {}
        self._lock = threading.Lock()
        threading.Thread(target=self._read_loop, daemon=True).start()

    def call(self, method: str, *args: Any) -> Any:
        request_id = generate_uuid()
        response_queue = queue.Queue(maxsize=1)

        with self._lock:
            self._pending[request_id] = response_queue

        # Process callbacks in args
        processed_args = []
        callback_ids = []
        for arg in args:
            if callable(arg):
                cb_id = generate_uuid()
                self._callbacks[cb_id] = arg
                callback_ids.append(cb_id)
                processed_args.append(f"{CALLBACK_PREFIX}{cb_id}")
            else:
                processed_args.append(arg)

        payload = {
            "id": request_id,
            "type": "request",
            "version": "json",
            "method": method,
            "args": processed_args,
        }
        if callback_ids:
            payload["callbackIds"] = callback_ids

        self._transport.write(encode_message(payload))
        return response_queue.get()

    def _read_loop(self):
        while True:
            line = self._transport.read()
            if line is None:
                break
            message = decode_message(line.strip())
            msg_type = message.get("type")

            if msg_type == "response":
                request_id = message.get("id")
                with self._lock:
                    q = self._pending.pop(request_id, None)
                if q:
                    q.put(message.get("args", {}).get("result"))
            elif msg_type == "callback":
                cb_id = message.get("method")
                cb = self._callbacks.get(cb_id)
                if cb:
                    cb(*message.get("args", []))
```

---

## References

- Go implementation: `interop/go/kkrpc/`
- Python implementation: `interop/python/kkrpc/`
- Rust implementation: `interop/rust/src/lib.rs`
- Swift implementation: `interop/swift/Sources/kkrpc/`
- Protocol spec: `interop/README.md`
- TypeScript core: `packages/kkrpc/src/serialization.ts`
