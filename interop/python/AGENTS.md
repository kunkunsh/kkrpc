# kkrpc - PYTHON INTEROP

**Generated:** 2026-02-05
**Location:** interop/python

## OVERVIEW

Python client/server library for kkrpc JSON-mode interop. Supports stdio and WebSocket transports with asyncio and threading options.

## STRUCTURE

```
python/
├── kkrpc/
│   ├── __init__.py        # Package exports
│   ├── client.py          # RpcClient implementation
│   ├── server.py          # RpcServer implementation
│   ├── protocol.py        # Message encoding/decoding
│   └── adapters/
│       ├── __init__.py
│       ├── base.py        # Transport abstract base class
│       ├── stdio.py       # StdioTransport
│       └── websocket.py   # WebSocketTransport
├── tests/
│   ├── conftest.py        # pytest fixtures
│   ├── test_stdio.py      # Stdio tests
│   └── test_ws.py         # WebSocket tests
├── pyproject.toml         # Package config (uv)
├── requirements.txt       # Dependencies
└── README.md              # Usage documentation
```

## KEY FILES

| File                    | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `client.py`             | RpcClient with call(), get(), set(), construct()    |
| `server.py`             | RpcServer with API registration                     |
| `protocol.py`           | encode_message(), decode_message(), generate_uuid() |
| `adapters/base.py`      | Transport ABC with read/write/close                 |
| `adapters/stdio.py`     | StdioTransport for subprocess communication         |
| `adapters/websocket.py` | WebSocketTransport (stdlib RFC6455)                 |

## IMPLEMENTATION PATTERNS

### Transport ABC

```python
class Transport(ABC):
    @abstractmethod
    def read(self) -> Optional[str]: ...
    @abstractmethod
    def write(self, message: str) -> None: ...
    @abstractmethod
    def close(self) -> None: ...
```

### Client Usage

```python
from kkrpc import RpcClient, StdioTransport

transport = StdioTransport.from_process(["bun", "server.ts"])
client = RpcClient(transport)
result = client.call("math.add", 1, 2)
```

### Server Usage

```python
from kkrpc import RpcServer, StdioTransport

api = {
    "math.add": lambda args: args[0] + args[1],
    "echo": lambda args: args[0],
}
server = RpcServer(StdioTransport.from_stdio(), api)
server.serve_forever()
```

## CONVENTIONS

- **Naming**: snake_case for functions/variables
- **Types**: Type hints throughout (Python 3.12+)
- **Concurrency**: Threading for I/O, queue for pending requests
- **Error handling**: RpcError exception with name/data fields

## COMMANDS

```bash
# Install dependencies
pip install -r requirements.txt

# Run tests
pytest tests/

# With coverage
pytest --cov=kkrpc tests/
```

## NOTES

- Python 3.12+ required
- No external runtime dependencies
- WebSocket uses stdlib-only RFC6455 implementation
- Callbacks encoded as `__callback__<id>` strings
- Compatible with kkrpc `serialization.version = "json"`

## TESTING

Tests use pytest with fixtures for stdio and WebSocket scenarios:

- `test_stdio.py`: Process-to-process communication
- `test_ws.py`: WebSocket client/server tests
