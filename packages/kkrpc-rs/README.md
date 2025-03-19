# kkrpc-rs

A Rust implementation of the kkrpc protocol, enabling bidirectional RPC communication between processes.

## Overview

kkrpc-rs provides a Rust implementation of the kkrpc protocol, allowing seamless communication between Rust and other language implementations (TypeScript, Python, etc.) using the same message format and communication patterns.

## Core Components

### IoInterface

The `IoInterface` trait defines the communication channels for reading and writing data:

```rust
#[async_trait]
pub trait IoInterface: Send + Sync {
    fn name(&self) -> String;
    async fn read(&self) -> Option<Vec<u8>>;
    async fn write(&self, data: String) -> io::Result<()>;
}
```

Implementations include:
- `StdioInterface`: For communication over standard input/output
- Custom IO interfaces can be created for other channels

### RPCChannel

The main channel that handles the bidirectional communication:

```rust
pub struct RPCChannel<Io: IoInterface + 'static> {
    // Implementation details
}

impl<Io: IoInterface + 'static> RPCChannel<Io> {
    pub fn new(io: Io, expose: Option<Value>) -> Self { /* ... */ }
    pub fn expose(&self, api: Value) { /* ... */ }
    pub async fn call_method(&self, method: &str, args: Vec<Value>) -> Result<Value, String> { /* ... */ }
    pub fn get_api(&self) -> RPCProxy<Io> { /* ... */ }
}
```

### RPCProxy

A proxy mechanism for making method calls with a more natural API:

```rust
pub struct RPCProxy<Io: IoInterface + 'static> {
    channel: RPCChannel<Io>,
    path: Vec<String>,
}

impl<Io: IoInterface + 'static> RPCProxy<Io> {
    pub fn method(&self, name: &str) -> Self { /* ... */ }
    pub async fn call(&self, args: Vec<Value>) -> Result<Value, String> { /* ... */ }
}
```

## Using the Library

### Basic Example

```rust
use kkrpc_rs::{RPCChannel, StdioInterface};
use serde_json::json;

#[tokio::main]
async fn main() {
    // Create an IO interface
    let io = StdioInterface::new();
    
    // API that we'll expose to remote calls
    let api = json!({
        "math": {
            "add": "function",
            "subtract": "function"
        },
        "echo": "function"
    });
    
    // Create an RPC channel
    let rpc = RPCChannel::new(io, Some(api));
    
    // Get a proxy to the remote API
    let remote_api = rpc.get_api();
    
    // Call a remote method
    let result = remote_api.method("echo").call(vec![json!("Hello from Rust!")]).await;
    match result {
        Ok(response) => println!("Result: {}", response),
        Err(e) => eprintln!("Error: {}", e),
    }
}
```

### Communicating with Python

```rust
use kkrpc_rs::{RPCChannel, IoInterface};
use serde_json::json;
use std::process::{Command, Stdio};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use async_trait::async_trait;

struct ChildProcessIO {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

#[async_trait]
impl IoInterface for ChildProcessIO {
    fn name(&self) -> String { "child_process".to_string() }
    
    async fn read(&self) -> Option<Vec<u8>> {
        let mut line = String::new();
        match self.stdout.read_line(&mut line).await {
            Ok(0) => None,
            Ok(_) => Some(line.into_bytes()),
            Err(_) => None,
        }
    }
    
    async fn write(&self, data: String) -> std::io::Result<()> {
        self.stdin.write_all(data.as_bytes()).await
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Start a Python process
    let mut child = Command::new("python")
        .arg("your_python_script.py")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;
        
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    
    let io = ChildProcessIO {
        stdin,
        stdout: BufReader::new(stdout),
    };
    
    // Create RPC channel
    let rpc = RPCChannel::new(io, None);
    let api = rpc.get_api();
    
    // Call a method in the Python process
    let result = api.method("add").call(vec![json!(1), json!(2)]).await?;
    println!("1 + 2 = {}", result);
    
    Ok(())
}
```

## Benefits of the Rust Implementation

1. **Type Safety**: Leverages Rust's strong typing system
2. **Concurrency**: Uses Tokio for asynchronous operation
3. **Performance**: High-performance implementation for resource-intensive applications
4. **Cross-language Communication**: Compatible with other kkrpc implementations
5. **Memory Safety**: Provides memory safety guarantees through Rust's ownership model

## Proxy Pattern in Rust

Unlike JavaScript's dynamic Proxy API, the Rust implementation uses a more explicit method chaining approach:

```rust
// JavaScript style in TypeScript
const result = await api.math.add(1, 2);

// Rust equivalent
let result = api.method("math").method("add").call(vec![json!(1), json!(2)]).await?;
```

While not as seamless as JavaScript's proxy, this approach provides a reasonably clean API while maintaining Rust's static typing benefits.

## Roadmap

Future improvements:
- Macro-based API for more seamless usage
- Code generation from API definitions
- More IO implementations (HTTP, WebSockets, etc.)
- Type-safe callback handling 