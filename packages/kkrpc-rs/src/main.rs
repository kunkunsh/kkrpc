use std::collections::HashMap;
use std::future::Future;
use std::io::{self, BufRead, BufReader, Write};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::{thread, time};

use async_trait::async_trait;
use futures::channel::oneshot;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::runtime::Runtime;
use uuid::Uuid;

// IO Interface
#[async_trait]
pub trait IoInterface: Send + Sync {
    fn name(&self) -> String;
    async fn read(&self) -> Option<Vec<u8>>;
    async fn write(&self, data: String) -> io::Result<()>;
}

// Stdio Implementation of IoInterface
pub struct StdioInterface {
    reader: Arc<Mutex<BufReader<io::Stdin>>>,
}

impl StdioInterface {
    pub fn new() -> Self {
        StdioInterface {
            reader: Arc::new(Mutex::new(BufReader::new(io::stdin()))),
        }
    }
}

#[async_trait]
impl IoInterface for StdioInterface {
    fn name(&self) -> String {
        "stdio".to_string()
    }

    async fn read(&self) -> Option<Vec<u8>> {
        let reader = self.reader.clone();
        let result = tokio::task::spawn_blocking(move || {
            let mut buffer = Vec::new();
            let mut reader = reader.lock().unwrap();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) => None,
                Ok(_) => Some(buffer),
                Err(_) => None,
            }
        })
        .await;

        result.unwrap_or(None)
    }

    async fn write(&self, data: String) -> io::Result<()> {
        io::stdout().write_all(data.as_bytes())?;
        io::stdout().flush()
    }
}

// Message Serialization
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageType {
    Request,
    Response,
    Callback,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub method: String,
    pub args: Value,
    #[serde(rename = "type")]
    pub msg_type: MessageType,
    pub callback_ids: Option<Vec<String>>,
    pub version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Response<T> {
    pub result: Option<T>,
    pub error: Option<String>,
}

pub fn serialize_message(message: &Message) -> String {
    serde_json::to_string(&message).unwrap_or_default() + "\n"
}

pub fn deserialize_message(message_str: &str) -> Result<Message, serde_json::Error> {
    serde_json::from_str(message_str)
}

// RPC Channel
type PendingRequestMap = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;
type CallbackMap = Arc<Mutex<HashMap<String, Box<dyn Fn(Vec<Value>) -> () + Send + Sync>>>>;

pub struct RPCChannel<Io: IoInterface + 'static> {
    io: Arc<Io>,
    api_implementation: Arc<Mutex<Value>>,
    pending_requests: PendingRequestMap,
    callbacks: CallbackMap,
}

impl<Io: IoInterface + 'static> RPCChannel<Io> {
    pub fn new(io: Io, expose: Option<Value>) -> Self {
        let channel = RPCChannel {
            io: Arc::new(io),
            api_implementation: Arc::new(Mutex::new(expose.unwrap_or(json!({})))),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            callbacks: Arc::new(Mutex::new(HashMap::new())),
        };

        // Start listening for messages
        let io_clone = channel.io.clone();
        let pending_requests = channel.pending_requests.clone();
        let callbacks = channel.callbacks.clone();
        let api = channel.api_implementation.clone();

        tokio::spawn(async move {
            let mut message_str = String::new();

            loop {
                if let Some(buffer) = io_clone.read().await {
                    let buffer_str = String::from_utf8_lossy(&buffer).to_string();
                    if buffer_str.trim().is_empty() {
                        continue;
                    }

                    message_str.push_str(&buffer_str);
                    let last_char = message_str.chars().last();
                    let msgs_split: Vec<&str> = message_str.split('\n').collect();
                    
                    let msgs = if last_char == Some('\n') {
                        msgs_split
                    } else {
                        msgs_split[..msgs_split.len() - 1].to_vec()
                    };

                    message_str = if last_char == Some('\n') {
                        String::new()
                    } else {
                        msgs_split.last().unwrap_or(&"").to_string()
                    };

                    for msg_str in msgs.iter().map(|m| m.trim()).filter(|m| !m.is_empty()) {
                        if msg_str.starts_with('{') {
                            match deserialize_message(msg_str) {
                                Ok(parsed_message) => {
                                    match parsed_message.msg_type {
                                        MessageType::Response => {
                                            handle_response(&pending_requests, &parsed_message);
                                        }
                                        MessageType::Request => {
                                            let io_for_req = io_clone.clone();
                                            let api_clone = api.clone();
                                            tokio::spawn(async move {
                                                handle_request(io_for_req, api_clone, parsed_message).await;
                                            });
                                        }
                                        MessageType::Callback => {
                                            handle_callback(&callbacks, &parsed_message);
                                        }
                                    }
                                }
                                Err(e) => {
                                    eprintln!("Error deserializing message: {}", e);
                                }
                            }
                        } else {
                            println!("(kkrpc stdout passthrough): {}", msg_str);
                        }
                    }
                }
            }
        });

        channel
    }

    pub fn expose(&self, api: Value) {
        let mut api_impl = self.api_implementation.lock().unwrap();
        *api_impl = api;
    }

    pub async fn call_method(&self, method: &str, args: Vec<Value>) -> Result<Value, String> {
        let request_id = Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        
        {
            let mut pending_requests = self.pending_requests.lock().unwrap();
            pending_requests.insert(request_id.clone(), sender);
        }

        let message = Message {
            id: request_id,
            method: method.to_string(),
            args: json!(args),
            msg_type: MessageType::Request,
            callback_ids: None,
            version: Some("json".to_string()),
        };

        if let Err(e) = self.io.write(serialize_message(&message)).await {
            return Err(format!("Failed to send request: {}", e));
        }

        receiver.await.unwrap_or(Err("Request cancelled".to_string()))
    }
    
    pub fn get_api(&self) -> RPCProxy {
        RPCProxy {
            channel: self.clone(),
            path: Vec::new(),
        }
    }
}

impl<Io: IoInterface + 'static> Clone for RPCChannel<Io> {
    fn clone(&self) -> Self {
        RPCChannel {
            io: self.io.clone(),
            api_implementation: self.api_implementation.clone(),
            pending_requests: self.pending_requests.clone(),
            callbacks: self.callbacks.clone(),
        }
    }
}

// Helper functions for handling messages
fn handle_response(pending_requests: &PendingRequestMap, response: &Message) {
    let mut pending = pending_requests.lock().unwrap();
    if let Some(sender) = pending.remove(&response.id) {
        if let Some(error) = response.args.get("error").and_then(|e| e.as_str()) {
            let _ = sender.send(Err(error.to_string()));
        } else {
            let result = response.args.get("result").cloned().unwrap_or(Value::Null);
            let _ = sender.send(Ok(result));
        }
    }
}

async fn handle_request(io: Arc<impl IoInterface>, api: Arc<Mutex<Value>>, request: Message) {
    let method_path: Vec<&str> = request.method.split('.').collect();
    let api_lock = api.lock().unwrap();
    
    // Navigate to the target method in the API implementation
    let mut current = api_lock.clone();
    for (i, &component) in method_path.iter().enumerate().take(method_path.len() - 1) {
        if let Some(obj) = current.get(component) {
            current = obj.clone();
        } else {
            let error_msg = format!("Method path {} not found at {}", request.method, component);
            send_error(io.clone(), &request.id, &error_msg).await;
            return;
        }
    }

    let final_method = method_path.last().unwrap_or(&"");
    
    // Execute method (in a real implementation, you'd call actual functions)
    // This is simplified to just echo back the arguments
    let args = request.args.as_array().cloned().unwrap_or_default();
    send_response(io, &request.id, Value::String(format!("Called {} with {:?}", request.method, args))).await;
}

fn handle_callback(callbacks: &CallbackMap, message: &Message) {
    let callbacks_lock = callbacks.lock().unwrap();
    if let Some(callback) = callbacks_lock.get(&message.method) {
        let args = message.args.as_array().cloned().unwrap_or_default();
        callback(args);
    } else {
        eprintln!("Callback with id {} not found", message.method);
    }
}

async fn send_response(io: Arc<impl IoInterface>, request_id: &str, result: Value) {
    let response = Message {
        id: request_id.to_string(),
        method: "".to_string(),
        args: json!({ "result": result }),
        msg_type: MessageType::Response,
        callback_ids: None,
        version: Some("json".to_string()),
    };
    
    if let Err(e) = io.write(serialize_message(&response)).await {
        eprintln!("Failed to send response: {}", e);
    }
}

async fn send_error(io: Arc<impl IoInterface>, request_id: &str, error: &str) {
    let response = Message {
        id: request_id.to_string(),
        method: "".to_string(),
        args: json!({ "error": error }),
        msg_type: MessageType::Response,
        callback_ids: None,
        version: Some("json".to_string()),
    };
    
    if let Err(e) = io.write(serialize_message(&response)).await {
        eprintln!("Failed to send error: {}", e);
    }
}

// Proxy for remote API
#[derive(Clone)]
pub struct RPCProxy {
    channel: RPCChannel<StdioInterface>,
    path: Vec<String>,
}

impl RPCProxy {
    pub fn method(&self, name: &str) -> RPCProxy {
        let mut new_path = self.path.clone();
        new_path.push(name.to_string());
        
        RPCProxy {
            channel: self.channel.clone(),
            path: new_path,
        }
    }
    
    pub async fn call(&self, args: Vec<Value>) -> Result<Value, String> {
        let method = self.path.join(".");
        self.channel.call_method(&method, args).await
    }
}

// Example usage
#[tokio::main]
async fn main() {
    let io = StdioInterface::new();
    
    // API that we'll expose to remote calls
    let api = json!({
        "math": {
            "add": "function",
            "subtract": "function"
        },
        "echo": "function"
    });
    
    let rpc = RPCChannel::new(io, Some(api));
    
    // Create a proxy to the remote API
    let remote_api = rpc.get_api();
    
    // Example call to a remote method (in a real app, this would be calling a different process)
    match remote_api.method("echo").call(vec![json!("Hello from Rust!")]).await {
        Ok(result) => println!("Result: {}", result),
        Err(e) => eprintln!("Error: {}", e),
    }
    
    // Keep the process running for demonstration
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }
}
