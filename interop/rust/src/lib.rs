use rand::Rng;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex};
use std::thread;

pub const CALLBACK_PREFIX: &str = "__callback__";

type Callback = Arc<dyn Fn(Vec<Value>) + Send + Sync + 'static>;

type ResponseSender = std::sync::mpsc::Sender<ResponsePayload>;

type ResponseReceiver = std::sync::mpsc::Receiver<ResponsePayload>;

#[derive(Debug)]
pub struct RpcError {
    pub name: Option<String>,
    pub message: String,
    pub data: Value,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(name) = &self.name {
            write!(f, "{}: {}", name, self.message)
        } else {
            write!(f, "{}", self.message)
        }
    }
}

impl std::error::Error for RpcError {}

#[derive(Debug)]
struct ResponsePayload {
    result: Option<Value>,
    error: Option<RpcError>,
}

pub enum Arg {
    Value(Value),
    Callback(Callback),
}

pub struct Client<W: Write + Send + 'static> {
    writer: Arc<Mutex<W>>,
    pending: Arc<Mutex<HashMap<String, ResponseSender>>>,
    callbacks: Arc<Mutex<HashMap<String, Callback>>>,
}

impl<W: Write + Send + 'static> Client<W> {
    pub fn new<R: std::io::Read + Send + 'static>(reader: R, writer: W) -> Self {
        let pending: Arc<Mutex<HashMap<String, ResponseSender>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let callbacks: Arc<Mutex<HashMap<String, Callback>>> = Arc::new(Mutex::new(HashMap::new()));
        let writer = Arc::new(Mutex::new(writer));

        let pending_clone = Arc::clone(&pending);
        let callbacks_clone = Arc::clone(&callbacks);
        thread::spawn(move || {
            let buffered = BufReader::new(reader);
            for line in buffered.lines() {
                let line = match line {
                    Ok(line) => line,
                    Err(_) => break,
                };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let message: Value = match serde_json::from_str(trimmed) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let message_type = message.get("type").and_then(|v| v.as_str());
                match message_type {
                    Some("response") => handle_response(&pending_clone, message),
                    Some("callback") => handle_callback(&callbacks_clone, message),
                    _ => {}
                }
            }
        });

        Self {
            writer,
            pending,
            callbacks,
        }
    }

    pub fn call(&self, method: &str, args: Vec<Arg>) -> Result<Value, RpcError> {
        let request_id = generate_uuid();
        let (sender, receiver): (ResponseSender, ResponseReceiver) = std::sync::mpsc::channel();
        self.pending
            .lock()
            .expect("pending lock")
            .insert(request_id.clone(), sender);

        let mut processed_args: Vec<Value> = Vec::new();
        let mut callback_ids: Vec<Value> = Vec::new();

        for arg in args {
            match arg {
                Arg::Value(value) => processed_args.push(value),
                Arg::Callback(callback) => {
                    let callback_id = generate_uuid();
                    self.callbacks
                        .lock()
                        .expect("callbacks lock")
                        .insert(callback_id.clone(), callback);
                    callback_ids.push(Value::String(callback_id.clone()));
                    processed_args
                        .push(Value::String(format!("{}{}", CALLBACK_PREFIX, callback_id)));
                }
            }
        }

        let mut payload = serde_json::Map::new();
        payload.insert("id".to_string(), Value::String(request_id.clone()));
        payload.insert("method".to_string(), Value::String(method.to_string()));
        payload.insert("args".to_string(), Value::Array(processed_args));
        payload.insert("type".to_string(), Value::String("request".to_string()));
        payload.insert("version".to_string(), Value::String("json".to_string()));
        if !callback_ids.is_empty() {
            payload.insert("callbackIds".to_string(), Value::Array(callback_ids));
        }

        write_message(&self.writer, Value::Object(payload));

        let response = receiver.recv().expect("response received");
        if let Some(error) = response.error {
            return Err(error);
        }
        Ok(response.result.unwrap_or(Value::Null))
    }
}

fn handle_response(pending: &Arc<Mutex<HashMap<String, ResponseSender>>>, message: Value) {
    let request_id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let sender = pending.lock().expect("pending lock").remove(request_id);
    let sender = match sender {
        Some(sender) => sender,
        None => return,
    };

    let args = message.get("args").cloned().unwrap_or(Value::Null);
    if let Some(error_value) = args.get("error") {
        let error = if let Some(error_obj) = error_value.as_object() {
            let name = error_obj
                .get("name")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let message = error_obj
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("RPC error")
                .to_string();
            RpcError {
                name,
                message,
                data: error_value.clone(),
            }
        } else {
            RpcError {
                name: None,
                message: error_value.to_string(),
                data: error_value.clone(),
            }
        };
        let _ = sender.send(ResponsePayload {
            result: None,
            error: Some(error),
        });
        return;
    }

    let result = args.get("result").cloned();
    let _ = sender.send(ResponsePayload {
        result,
        error: None,
    });
}

fn handle_callback(callbacks: &Arc<Mutex<HashMap<String, Callback>>>, message: Value) {
    let callback_id = message.get("method").and_then(|v| v.as_str());
    let callback_id = match callback_id {
        Some(id) => id,
        None => return,
    };
    let callback = callbacks
        .lock()
        .expect("callbacks lock")
        .get(callback_id)
        .cloned();
    let callback = match callback {
        Some(callback) => callback,
        None => return,
    };
    let args = message
        .get("args")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    callback(args);
}

fn write_message<W: Write>(writer: &Arc<Mutex<W>>, message: Value) {
    let serialized = match serde_json::to_string(&message) {
        Ok(value) => value,
        Err(_) => return,
    };
    if let Ok(mut guard) = writer.lock() {
        let _ = writeln!(guard, "{}", serialized);
        let _ = guard.flush();
    }
}

pub fn generate_uuid() -> String {
    let mut rng = rand::thread_rng();
    let parts: Vec<String> = (0..4).map(|_| format!("{:x}", rng.gen::<u64>())).collect();
    parts.join("-")
}
