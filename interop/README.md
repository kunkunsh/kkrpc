# kkrpc Cross-Language Interop (Draft)

This folder provides a **minimal JSON-only** interoperability layer so non-JS runtimes can
speak to a TypeScript kkrpc endpoint over line-delimited JSON.

## Protocol Snapshot

- **Transport**: newline-delimited UTF-8 JSON strings.
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

### Python

- `interop/python/kkrpc.py` contains a small client + server implementation.
- `interop/python/smoke_test.py` starts a Bun/Node kkrpc server and exercises calls + callbacks.

### Go

- `interop/go/kkrpc.go` contains a small client implementation.
- `interop/go/smoke.go` starts a Bun/Node kkrpc server and exercises calls + callbacks.

### Rust

- `interop/rust/` contains a Cargo project with a JSON-mode client and smoke runner.

### Node Test Server

- `interop/node/server.ts` exposes `math.add`, `echo`, and `withCallback` using JSON mode.

## Design Notes

- This draft intentionally **omits transfer slots** and structured clone support.
- Cross-language targets should start with `version: "json"` and add SuperJSON support later
  if needed.
