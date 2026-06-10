# kkrpc-interop (Rust)

Rust client/server library for kkrpc JSON-mode interop. This crate implements the
kkrpc message protocol using JSON only for easy cross-language RPC.

## Features

- JSON request/response compatible with kkrpc's stable compact `RPCMessage` protocol.
- `stdio` and `ws` transports behind a `Transport` trait.
- Callback support using stable callback marker objects.

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
use kkrpc::{Arg, Client, StdioTransport};
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
use kkrpc::{Arg, Client, WebSocketTransport};
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
use kkrpc::{Arg, RpcApi, Server, StdioTransport};
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

- **Message format**: compact JSON records with `t`, `id`, `op`, `p`, `a`, and `v` fields.
- **Line-delimited transport**: each JSON message ends with `\n`.
- **Callbacks**: function arguments are encoded as `{ "__kkrpc_next_arg__": "callback", "id": "..." }` and dispatched with `t = "cb"`.
- **Adapters**: `Transport` is the common trait for `StdioTransport` and
  `WebSocketTransport`.

kkrpc JS clients/servers use the stable compact JSON `RPCMessage` protocol by default.
