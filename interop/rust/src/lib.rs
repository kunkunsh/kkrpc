use rand::Rng;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

pub const CALLBACK_PREFIX: &str = "__callback__";

pub trait Transport: Send + Sync {
    fn read(&self) -> Option<String>;
    fn write(&self, message: &str) -> Result<(), String>;
    fn close(&self);
}

pub struct StdioTransport<R: std::io::Read + Send + 'static, W: Write + Send + 'static> {
    reader: Mutex<BufReader<R>>,
    writer: Mutex<W>,
}

impl<R: std::io::Read + Send + 'static, W: Write + Send + 'static> StdioTransport<R, W> {
    pub fn new(reader: R, writer: W) -> Self {
        Self {
            reader: Mutex::new(BufReader::new(reader)),
            writer: Mutex::new(writer),
        }
    }
}

impl<R: std::io::Read + Send + 'static, W: Write + Send + 'static> Transport
    for StdioTransport<R, W>
{
    fn read(&self) -> Option<String> {
        let mut reader = self.reader.lock().ok()?;
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => None,
            Ok(_) => Some(line.trim().to_string()),
            Err(_) => None,
        }
    }

    fn write(&self, message: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|_| "lock".to_string())?;
        writer
            .write_all(message.as_bytes())
            .map_err(|err| err.to_string())?;
        writer.flush().map_err(|err| err.to_string())
    }

    fn close(&self) {}
}

pub struct WebSocketTransport {
    sender: Mutex<websocket::sender::Writer<std::net::TcpStream>>,
    queue: Arc<(Mutex<VecDeque<String>>, Condvar)>,
}

impl WebSocketTransport {
    pub fn connect(url: &str) -> Result<Arc<Self>, String> {
        let client = websocket::ClientBuilder::new(url)
            .map_err(|err| err.to_string())?
            .connect_insecure()
            .map_err(|err| err.to_string())?;
        let (receiver, sender) = client.split().map_err(|err| err.to_string())?;
        let queue = Arc::new((Mutex::new(VecDeque::new()), Condvar::new()));
        let queue_clone = Arc::clone(&queue);
        thread::spawn(move || {
            for message in receiver.incoming_messages() {
                match message {
                    Ok(websocket::OwnedMessage::Text(text)) => {
                        let (lock, cvar) = &*queue_clone;
                        let mut queue = lock.lock().unwrap();
                        queue.push_back(text);
                        cvar.notify_one();
                    }
                    Ok(websocket::OwnedMessage::Close(_)) | Err(_) => {
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(Arc::new(Self {
            sender: Mutex::new(sender),
            queue,
        }))
    }
}

impl Transport for WebSocketTransport {
    fn read(&self) -> Option<String> {
        let (lock, cvar) = &*self.queue;
        let mut queue = lock.lock().ok()?;
        while queue.is_empty() {
            queue = cvar.wait(queue).ok()?;
        }
        queue.pop_front()
    }

    fn write(&self, message: &str) -> Result<(), String> {
        let mut sender = self.sender.lock().map_err(|_| "lock".to_string())?;
        sender
            .send_message(&websocket::OwnedMessage::Text(message.to_string()))
            .map_err(|err| err.to_string())
    }

    fn close(&self) {
        let mut sender = match self.sender.lock() {
            Ok(sender) => sender,
            Err(_) => return,
        };
        let _ = sender.send_message(&websocket::OwnedMessage::Close(None));
    }
}

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

type Callback = Arc<dyn Fn(Vec<Value>) + Send + Sync + 'static>;

pub struct Client {
    transport: Arc<dyn Transport>,
    pending: Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<ResponsePayload>>>>,
    callbacks: Arc<Mutex<HashMap<String, Callback>>>,
}

impl Client {
    pub fn new(transport: Arc<dyn Transport>) -> Self {
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let callbacks = Arc::new(Mutex::new(HashMap::new()));
        let transport_clone = Arc::clone(&transport);
        let pending_clone = Arc::clone(&pending);
        let callbacks_clone = Arc::clone(&callbacks);

        thread::spawn(move || loop {
            let line = match transport_clone.read() {
                Some(line) => line,
                None => break,
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
        });

        Self {
            transport,
            pending,
            callbacks,
        }
    }

    pub fn call(&self, method: &str, args: Vec<Arg>) -> Result<Value, RpcError> {
        let request_id = generate_uuid();
        let (sender, receiver) = std::sync::mpsc::channel();
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

        write_message(&self.transport, Value::Object(payload));

        let response = receiver.recv().expect("response received");
        if let Some(error) = response.error {
            return Err(error);
        }
        Ok(response.result.unwrap_or(Value::Null))
    }

    pub fn close(&self) {
        self.transport.close();
    }
}

pub type Handler = Arc<dyn Fn(Vec<Arg>) -> Value + Send + Sync + 'static>;

#[derive(Default)]
pub struct RpcApi {
    data: Arc<Mutex<HashMap<String, Value>>>,
    methods: HashMap<String, Handler>,
    constructors: HashMap<String, Handler>,
}

impl RpcApi {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_method(&mut self, name: &str, handler: Handler) {
        self.methods.insert(name.to_string(), handler);
    }

    pub fn register_constructor(&mut self, name: &str, handler: Handler) {
        self.constructors.insert(name.to_string(), handler);
    }

    pub fn set_value(&self, path: &str, value: Value) {
        let mut data = self.data.lock().expect("data lock");
        data.insert(path.to_string(), value);
    }

    fn get_value(&self, path: &str) -> Option<Value> {
        self.data.lock().expect("data lock").get(path).cloned()
    }
}

pub struct Server {
    transport: Arc<dyn Transport>,
    api: Arc<RpcApi>,
}

impl Server {
    pub fn new(transport: Arc<dyn Transport>, api: RpcApi) -> Self {
        let server = Self {
            transport,
            api: Arc::new(api),
        };
        server.start();
        server
    }

    fn start(&self) {
        let transport = Arc::clone(&self.transport);
        let api = Arc::clone(&self.api);
        thread::spawn(move || loop {
            let line = match transport.read() {
                Some(line) => line,
                None => break,
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
                Some("request") => handle_server_request(&transport, &api, message),
                Some("get") => handle_server_get(&transport, &api, message),
                Some("set") => handle_server_set(&transport, &api, message),
                Some("construct") => handle_server_construct(&transport, &api, message),
                _ => {}
            }
        });
    }
}

fn handle_response(
    pending: &Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<ResponsePayload>>>>,
    message: Value,
) {
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

fn write_message(transport: &Arc<dyn Transport>, message: Value) {
    let serialized = match serde_json::to_string(&message) {
        Ok(value) => value,
        Err(_) => return,
    };
    let _ = transport.write(&format!("{}\n", serialized));
}

fn handle_server_request(transport: &Arc<dyn Transport>, api: &RpcApi, message: Value) {
    let request_id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let method = message.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let args = message
        .get("args")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let converted = wrap_callback_args(transport, request_id, args);
    let handler = api.methods.get(method);
    let result = handler.map(|call| call(converted)).unwrap_or(Value::Null);
    let payload = serde_json::json!({
        "id": request_id,
        "method": "",
        "args": { "result": result },
        "type": "response",
        "version": "json"
    });
    write_message(transport, payload);
}

fn handle_server_get(transport: &Arc<dyn Transport>, api: &RpcApi, message: Value) {
    let request_id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let path_values = message
        .get("path")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let path = path_values
        .iter()
        .filter_map(|value| value.as_str())
        .collect::<Vec<_>>()
        .join(".");
    let result = api.get_value(&path).unwrap_or(Value::Null);
    let payload = serde_json::json!({
        "id": request_id,
        "method": "",
        "args": { "result": result },
        "type": "response",
        "version": "json"
    });
    write_message(transport, payload);
}

fn handle_server_set(transport: &Arc<dyn Transport>, api: &RpcApi, message: Value) {
    let request_id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let path_values = message
        .get("path")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let path = path_values
        .iter()
        .filter_map(|value| value.as_str())
        .collect::<Vec<_>>()
        .join(".");
    let value = message.get("value").cloned().unwrap_or(Value::Null);
    api.set_value(&path, value);
    let payload = serde_json::json!({
        "id": request_id,
        "method": "",
        "args": { "result": true },
        "type": "response",
        "version": "json"
    });
    write_message(transport, payload);
}

fn handle_server_construct(transport: &Arc<dyn Transport>, api: &RpcApi, message: Value) {
    let request_id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let method = message.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let handler = api.constructors.get(method);
    let args = message
        .get("args")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let converted = wrap_callback_args(transport, request_id, args);
    let result = handler.map(|call| call(converted)).unwrap_or(Value::Null);
    let payload = serde_json::json!({
        "id": request_id,
        "method": "",
        "args": { "result": result },
        "type": "response",
        "version": "json"
    });
    write_message(transport, payload);
}

fn wrap_callback_args(
    transport: &Arc<dyn Transport>,
    request_id: &str,
    args: Vec<Value>,
) -> Vec<Arg> {
    args.into_iter()
        .map(|value| match value {
            Value::String(text) if text.starts_with(CALLBACK_PREFIX) => {
                let callback_id = text.trim_start_matches(CALLBACK_PREFIX).to_string();
                let transport_clone = Arc::clone(transport);
                let request_id = request_id.to_string();
                Arg::Callback(Arc::new(move |callback_args: Vec<Value>| {
                    let payload = serde_json::json!({
                        "id": request_id,
                        "method": callback_id,
                        "args": callback_args,
                        "type": "callback",
                        "version": "json"
                    });
                    write_message(&transport_clone, payload);
                }))
            }
            other => Arg::Value(other),
        })
        .collect()
}

pub fn generate_uuid() -> String {
    let mut rng = rand::thread_rng();
    let parts: Vec<String> = (0..4).map(|_| format!("{:x}", rng.gen::<u64>())).collect();
    parts.join("-")
}
