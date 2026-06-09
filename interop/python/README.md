# kkrpc-interop (Python)

Python client/server library for kkrpc JSON-mode interop. This package implements the same
message shape as kkrpc but **only uses JSON** (no SuperJSON), making it suitable for
cross-language use.

## Features

- JSON request/response compatible with kkrpc's stable compact `RPCMessage` protocol.
- `stdio` and `ws` transports via adapter classes.
- Callback support using stable callback marker objects and bidirectional calls.

## Installation

Once published, install from PyPI:

```bash
pip install kkrpc-interop
```

For local development from this repo:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r interop/python/requirements.txt
export PYTHONPATH="$PWD/interop/python:$PYTHONPATH"
```

## Usage

### Stdio client

```python
from kkrpc import RpcClient, StdioTransport

transport = StdioTransport.from_process(["bun", "interop/node/server.ts"])
client = RpcClient(transport)

result = client.call("math.add", [1, 2])
print(result)
```

### WebSocket client

```python
from kkrpc import RpcClient, WebSocketTransport

transport = WebSocketTransport("ws://localhost:8789")
client = RpcClient(transport)

result = client.call("echo", [{"hello": "kkrpc"}])
print(result)
```

### Server

```python
from kkrpc import RpcServer, StdioTransport

api = {
    "math.add": lambda args: args[0] + args[1],
    "echo": lambda args: args[0],
}

server = RpcServer(StdioTransport.from_stdio(), api)
server.serve_forever()
```

## Tests

```bash
pytest interop/python/tests
```

## How it works with kkrpc

- **Message format**: compact JSON records with `t`, `id`, `op`, `p`, `a`, and `v` fields.
- **Line-delimited transport**: each JSON message ends with `\n`.
- **Callbacks**: functions are encoded as `{ "__kkrpc_next_arg__": "callback", "id": "..." }` and sent via `t = "cb"`.
- **Adapters**: `StdioTransport` and `WebSocketTransport` implement a shared interface and
  can be swapped without changing the RPC client/server APIs.

This implementation is intentionally **JSON-only** and is compatible with the kkrpc JS side
because the stable JS side uses compact JSON `RPCMessage` records by default.
