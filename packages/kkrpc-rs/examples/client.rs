use kkrpc_rs::{RPCChannel, StdioInterface};
use serde_json::json;
use std::process::{Command, Stdio};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};

struct ChildProcessIO {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

#[async_trait::async_trait]
impl kkrpc_rs::IoInterface for ChildProcessIO {
    fn name(&self) -> String {
        "child_process".to_string()
    }

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
    // Start a child process that will serve as our remote endpoint
    // In a real application, this could be a server or another service
    let mut child = Command::new("python")
        .arg("-c")
        .arg(r#"
import json
import sys

# Simple echo server
while True:
    line = sys.stdin.readline()
    if not line:
        break
    try:
        message = json.loads(line)
        if message['type'] == 'request':
            response = {
                'id': message['id'],
                'method': '',
                'args': {'result': f"Echo: {message['args']}"},
                'type': 'response'
            }
            print(json.dumps(response))
            sys.stdout.flush()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.stderr.flush()
"#)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;

    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();

    let io = ChildProcessIO {
        stdin,
        stdout: BufReader::new(stdout),
    };

    // Create an RPC channel
    let rpc = RPCChannel::new(io, None);
    
    // Get a proxy to the remote API
    let api = rpc.get_api();
    
    // Call a method on the remote API
    let result = api.method("echo").call(vec![json!("Hello from Rust client!")]).await;
    
    match result {
        Ok(response) => println!("Received response: {}", response),
        Err(err) => eprintln!("Error: {}", err),
    }

    // Give the child process time to process and respond
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    
    // Terminate the child process
    child.kill().await?;
    
    Ok(())
} 