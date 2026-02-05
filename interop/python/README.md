# kkrpc-interop (Python)

Python client/server library for kkrpc JSON-mode interop. This package implements the same
message shape as kkrpc but **only uses JSON** (no SuperJSON), making it suitable for
cross-language use.

## Features

- JSON-mode request/response compatible with kkrpc `serialization.version = "json"`.
- `stdio` and `ws` transports via adapter classes.
- Callback support (`__callback__<id>` encoding) and bidirectional calls.

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

- **Message format**: JSON objects with `id`, `method`, `args`, `type`, `version`.
- **Line-delimited transport**: each JSON message ends with `\n`.
- **Callbacks**: functions are encoded as `__callback__<id>` and sent via `type = "callback"`.
- **Adapters**: `StdioTransport` and `WebSocketTransport` implement a shared interface and
  can be swapped without changing the RPC client/server APIs.

This implementation is intentionally **JSON-only** and is compatible with the kkrpc JS side
when `serialization.version` is set to `"json"`.
