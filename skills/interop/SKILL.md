---
name: kkrpc-interop
description: Implement kkrpc client/server in any programming language to communicate with TypeScript kkrpc endpoints. Covers the stable compact protocol, transports, and reference implementations in Go, Python, Rust, and Swift.
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

Implement kkrpc clients and servers in non-JS languages by speaking the stable compact JSON protocol used by TypeScript kkrpc endpoints.

## Reference Implementations

| Language | Location                       | Transports       |
| -------- | ------------------------------ | ---------------- |
| Go       | `interop/go/kkrpc/`            | stdio, WebSocket |
| Python   | `interop/python/kkrpc/`        | stdio, WebSocket |
| Rust     | `interop/rust/src/`            | stdio, WebSocket |
| Swift    | `interop/swift/Sources/kkrpc/` | stdio, WebSocket |

## Core Protocol

Interop uses JSON records. Stdio transports send newline-delimited UTF-8 JSON. WebSocket transports send the same JSON in text frames.

### Request

```json
{
	"t": "q",
	"id": "a1b2-c3d4",
	"op": "call",
	"p": ["math", "add"],
	"a": [1, 2]
}
```

Fields:

- `t`: message tag, always `q` for requests.
- `id`: unique request identifier.
- `op`: one of `call`, `get`, `set`, or `new`.
- `p`: method or property path as string segments.
- `a`: argument array for calls and constructors.
- `v`: value for property writes.

### Response

```json
{
	"t": "r",
	"id": "a1b2-c3d4",
	"v": 3
}
```

Errors use `e` with compact error fields:

```json
{
	"t": "r",
	"id": "a1b2-c3d4",
	"e": {
		"n": "Error",
		"m": "Division by zero",
		"s": "optional stack"
	}
}
```

### Callback Invocation

```json
{
	"t": "cb",
	"id": "callback-id",
	"a": ["progress", 50]
}
```

## Callback Argument Encoding

When sending a callable argument, generate an ID, store the callable locally, and replace the argument with a marker object.

```json
{
	"__kkrpc_next_arg__": "callback",
	"id": "callback-id"
}
```

When receiving this marker, create a wrapper function. Invoking the wrapper sends `t: "cb"` with the marker ID and argument array.

When receiving callback arguments from JS, unwrap value envelopes before invoking local callbacks.

```json
{
	"__kkrpc_next_arg__": "value",
	"v": "actual value"
}
```

## UUID Generation

Use any ID generator with low collision risk. IDs only need to match requests and responses within one connection.

```python
import uuid

def generate_uuid() -> str:
    return str(uuid.uuid4())
```

## Transport Layer

Every transport should provide these operations:

```text
read() -> string?   # Read one message, null/None if closed
write(message)      # Write one JSON string
close()             # Close connection
```

Stdio transports append `\n` and flush immediately. WebSocket transports send and receive text frames containing a single JSON record.

## Client Algorithm

1. Convert a dotted method name such as `math.add` to `p: ["math", "add"]`.
2. Encode arguments, replacing callables with callback marker objects.
3. Send a request record with `t: "q"`, unique `id`, `op`, `p`, and optional `a` or `v`.
4. Store a pending completion keyed by request ID.
5. In the read loop, resolve pending calls for `t: "r"` records.
6. In the read loop, dispatch `t: "cb"` records to stored callbacks.

## Server Algorithm

1. Read JSON messages from the transport.
2. Ignore records that are not `t: "q"` unless your server also stores callbacks.
3. Dispatch `op: "call"` by joining `p` into the registered method name.
4. Dispatch `op: "get"` and `op: "set"` against registered property handlers if supported.
5. Encode successful results as `{ "t": "r", "id": requestId, "v": result }`.
6. Encode failures as `{ "t": "r", "id": requestId, "e": { "n": name, "m": message } }`.

## Minimal Client Pseudocode

```python
def call(method, *args):
    request_id = generate_uuid()
    payload = {
        "t": "q",
        "id": request_id,
        "op": "call",
        "p": method.split("."),
        "a": [encode_arg(arg) for arg in args],
    }
    transport.write(json.dumps(payload))
    response = wait_for_response(request_id)
    if "e" in response:
        raise RpcError(response["e"].get("m", "RPC error"))
    return response.get("v")
```

## Minimal Server Pseudocode

```python
def handle(message):
    if message.get("t") != "q":
        return
    try:
        method = ".".join(message.get("p", []))
        args = [decode_arg(arg) for arg in message.get("a", [])]
        result = api[method](args)
        transport.write(json.dumps({"t": "r", "id": message["id"], "v": result}))
    except Exception as exc:
        transport.write(json.dumps({
            "t": "r",
            "id": message["id"],
            "e": {"n": exc.__class__.__name__, "m": str(exc)},
        }))
```

## Testing Checklist

- Call JS server methods from the non-JS client.
- Call non-JS server methods from a JS client.
- Verify nested method paths.
- Verify property get and set if implemented.
- Verify callback marker encoding and `t: "cb"` dispatch.
- Verify error responses preserve name and message.
- Verify stdio newline framing and WebSocket text framing.

## Common Pitfalls

- Do not send dotted method names in the wire message. Use path arrays in `p`.
- Do not wrap responses in custom result objects. Put successful values in `v`.
- Do not use binary WebSocket frames for the JSON interop protocol.
- Do not forget to unwrap `{ "__kkrpc_next_arg__": "value", "v": ... }` callback arguments.
- Do not rely on JS-specific transfer slots or structured clone in language interop.
