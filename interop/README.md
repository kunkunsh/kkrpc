# kkrpc Cross-Language Interop (Draft)

This folder provides a **JSON-only** interoperability layer so non-JS runtimes can
speak to a TypeScript kkrpc endpoint over line-delimited JSON (stdio) or WebSocket.

## Protocol Snapshot

- **Transport**:
  - **stdio**: newline-delimited UTF-8 JSON strings.
  - **ws**: text frames containing the same JSON payloads (newline suffix optional).
- **Serialization**:
  - `version: "json"` indicates plain JSON.
  - SuperJSON messages start with `{ "json": ... }` and are parsed by JS/TS; other runtimes
    can choose to ignore or only implement `version: "json"`.
- **Message shape**:

```json
{
  "id": "<random-id>",
  "method": "math.add",
  "args": [1, 2],
  "type": "request",
  "version": "json",
  "callbackIds": ["<optional-callback-id>"]
}
```

### Message Types

| type        | Required fields                     | Notes |
| ----------- | ----------------------------------- | ----- |
| `request`   | `id`, `method`, `args`              | Remote function call.
| `response`  | `id`, `args.result` or `args.error` | Returned by server or client.
| `callback`  | `method` (callback id), `args`      | Invokes a previously sent callback.
| `get`       | `id`, `path`                        | Property read.
| `set`       | `id`, `path`, `value`               | Property write.
| `construct` | `id`, `method`, `args`              | Remote constructor call.

### Callback Encoding

If an argument is a callable, it is replaced by a string marker:

```
"__callback__<callback-id>"
```

The receiver stores a callback map keyed by `<callback-id>` and sends a `callback`
message when invoked.

## Implementations

### Python (library + tests)

- `interop/python/kkrpc/` exposes `RpcClient`, `RpcServer`, and stdio/ws transports.
- Adapter design: each transport implements a small `Transport` interface with `read`, `write`,
  and `close`.
- WebSocket transport uses a minimal stdlib-only RFC6455 client (no external deps).

Example (stdio):

```python
from kkrpc import RpcClient, StdioTransport

transport = StdioTransport(proc.stdout, proc.stdin)
client = RpcClient(transport)
result = client.call("math.add", 1, 2)
```

Example (ws):

```python
from kkrpc import RpcClient, WebSocketTransport

client = RpcClient(WebSocketTransport("ws://localhost:8789"))
result = client.call("math.add", 1, 2)
```
- `interop/python/tests/` contains pytest suites for stdio and ws.

Run tests:

```bash
python -m pip install -r interop/python/requirements.txt
pytest interop/python/tests
```

### Go (library + tests)

- `interop/go/kkrpc/` contains transport adapters and RPC client/server.
- Adapter design: `Transport` interface + `StdioTransport` and `WebSocketTransport`.

Example (stdio):

```go
transport := kkrpc.NewStdioTransport(stdout, stdin)
client := kkrpc.NewClient(transport)
result, _ := client.Call("math.add", 1, 2)
```

Example (ws):

```go
transport, _ := kkrpc.NewWebSocketTransport("ws://localhost:8789")
client := kkrpc.NewClient(transport)
result, _ := client.Call("math.add", 1, 2)
```
- `interop/go/kkrpc/*_test.go` runs stdio + ws tests.

Run tests:

```bash
cd interop/go
go test ./...
```

### Rust (library + tests)

- `interop/rust/src/lib.rs` provides transports and RPC client/server.
- Adapter design: `Transport` trait with stdio + WebSocket implementations.

Example (stdio):

```rust
let transport = StdioTransport::new(stdout, stdin);
let client = Client::new(std::sync::Arc::new(transport));
let result = client.call("math.add", vec![Arg::Value(json!(1)), Arg::Value(json!(2))])?;
```

Example (ws):

```rust
let transport = WebSocketTransport::connect("ws://localhost:8789")?;
let client = Client::new(transport);
let result = client.call("math.add", vec![Arg::Value(json!(1)), Arg::Value(json!(2))])?;
```
- `interop/rust/tests/` runs stdio + ws tests.

Run tests:

```bash
cd interop/rust
cargo test
```

### Node Test Servers

- `interop/node/server.ts` exposes `math.add`, `echo`, and `withCallback` using JSON mode.
- `interop/node/ws-server.ts` exposes the same API over WebSocket.

## Design Notes

- This draft intentionally **omits transfer slots** and structured clone support.
- Cross-language targets should start with `version: "json"` and add SuperJSON support later
  if needed.
