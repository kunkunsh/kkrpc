# kkrpc-interop (Rust)

Rust client/server library for kkrpc JSON-mode interop. This crate implements the
kkrpc message protocol using JSON only for easy cross-language RPC.

## Features

- JSON-mode request/response compatible with kkrpc `serialization.version = "json"`.
- `stdio` and `ws` transports behind a `Transport` trait.
- Callback support using `__callback__<id>` tokens.

## Installation

When published:

```bash
cargo add kkrpc-interop
```

From this repository:

```bash
cd interop/rust

cargo test
```

## Usage

### Stdio client

```rust
use kkrpc_interop::{Arg, Client, StdioTransport};
use serde_json::json;
use std::process::{Command, Stdio};
use std::sync::Arc;

fn main() {
    let mut child = Command::new("bun")
        .arg("interop/node/server.ts")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn bun server");

    let stdout = child.stdout.take().expect("stdout");
    let stdin = child.stdin.take().expect("stdin");

    let transport = StdioTransport::new(stdout, stdin);
    let client = Client::new(Arc::new(transport));

    let result = client
        .call("math.add", vec![Arg::Value(json!(1)), Arg::Value(json!(2))])
        .expect("call math.add");
    println!("{result}");
}
```

### WebSocket client

```rust
use kkrpc_interop::{Arg, Client, WebSocketTransport};
use serde_json::json;

fn main() {
    let transport = WebSocketTransport::connect("ws://localhost:8789")
        .expect("connect ws");
    let client = Client::new(transport);

    let result = client
        .call("echo", vec![Arg::Value(json!({"hello": "kkrpc"}))])
        .expect("call echo");
    println!("{result}");
}
```

### Server

```rust
use kkrpc_interop::{Arg, RpcApi, Server, StdioTransport};
use serde_json::Value;
use std::sync::Arc;

fn main() {
    let transport = Arc::new(StdioTransport::new(std::io::stdin(), std::io::stdout()));
    let mut api = RpcApi::new();
    api.register_method("math.add", Arc::new(|args: Vec<Arg>| {
        let a = match &args[0] { Arg::Value(value) => value.as_i64().unwrap_or(0), _ => 0 };
        let b = match &args[1] { Arg::Value(value) => value.as_i64().unwrap_or(0), _ => 0 };
        Value::from(a + b)
    }));

    let _server = Server::new(transport, api);
    loop {
        std::thread::park();
    }
}
```

## Tests

```bash
cd interop/rust

cargo test
```

## How it works with kkrpc

- **Message format**: JSON objects with `id`, `method`, `args`, `type`, `version`.
- **Line-delimited transport**: each JSON message ends with `\n`.
- **Callbacks**: function arguments are encoded as `__callback__<id>` and dispatched via
  `type = "callback"`.
- **Adapters**: `Transport` is the common trait for `StdioTransport` and
  `WebSocketTransport`.

Use `serialization.version = "json"` on the kkrpc JS side for compatibility.
