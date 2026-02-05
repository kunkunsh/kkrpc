# kkrpc - RUST INTEROP

**Generated:** 2026-02-05
**Location:** interop/rust

## OVERVIEW

Rust client/server library for kkrpc JSON-mode interop. Thread-safe implementation using Arc and Mutex, with stdio and WebSocket transports.

## STRUCTURE

```
rust/
├── src/
│   └── lib.rs             # Main library (client, server, transports)
├── tests/
│   ├── stdio.rs           # Stdio integration tests
│   └── ws.rs              # WebSocket integration tests
├── Cargo.toml             # Package manifest
└── README.md              # Usage documentation
```

## KEY FILES

| File             | Purpose                                          |
| ---------------- | ------------------------------------------------ |
| `lib.rs`         | Client, Server, RpcApi, transports, protocol     |
| `tests/stdio.rs` | Stdio transport tests                            |
| `tests/ws.rs`    | WebSocket transport tests                        |
| `Cargo.toml`     | Dependencies: serde, serde_json, websocket, rand |

## IMPLEMENTATION PATTERNS

### Transport Trait

```rust
pub trait Transport: Send + Sync {
    fn read(&self) -> Result<Option<String>, TransportError>;
    fn write(&self, message: &str) -> Result<(), TransportError>;
    fn close(&self) -> Result<(), TransportError>;
}
```

### Client Usage

```rust
use kkrpc::{Client, StdioTransport, Arg};
use serde_json::json;
use std::sync::Arc;

let transport = StdioTransport::new(stdout, stdin);
let client = Client::new(Arc::new(transport));
let result = client.call(
    "math.add",
    vec![Arg::Value(json!(1)), Arg::Value(json!(2))]
)?;
```

### Server Usage

```rust
use kkrpc::{Server, RpcApi, StdioTransport, Arg};
use serde_json::Value;
use std::sync::Arc;

let mut api = RpcApi::new();
api.register_method("math.add", Arc::new(|args: Vec<Arg>| {
    // Extract and process args
    Value::from(result)
}));

let transport = Arc::new(StdioTransport::new(stdin, stdout));
let _server = Server::new(transport, api);
```

## CONVENTIONS

- **Naming**: CamelCase for types, snake_case for functions
- **Error handling**: Result<T, E> throughout
- **Concurrency**: Arc<Mutex<>> for shared state
- **Thread safety**: Send + Sync bounds on Transport

## COMMANDS

```bash
# Run tests
cargo test

# Build release
cargo build --release

# Generate docs
cargo doc --open
```

## NOTES

- Rust 1.85+ required (2024 edition)
- Thread-safe with Arc/Mutex
- Callbacks encoded as `__callback__<id>` strings
- Arg enum for callback vs value distinction
- Compatible with kkrpc `serialization.version = "json"`

## DEPENDENCIES

- `serde` / `serde_json`: Serialization
- `websocket`: WebSocket client
- `rand`: UUID generation
- `regex`: String processing
