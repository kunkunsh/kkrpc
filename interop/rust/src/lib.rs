//! # kkrpc-interop
//!
//! Rust client/server library for kkrpc JSON-mode interop.
//!
//! This crate implements the kkrpc message protocol using JSON only,
//! enabling cross-language RPC between Rust and TypeScript/JavaScript.
//!
//! ## Features
//!
//! - **JSON-mode request/response** compatible with kkrpc `serialization.version = "json"`
//! - **stdio and WebSocket transports** with a shared [`Transport`] trait
//! - **Callback support** using `__callback__<id>` tokens
//! - **Property access** (get/set) for remote object manipulation
//! - **Thread-safe** implementation using Arc and Mutex
//!
//! ## Quick Start
//!
//! ### Client Example
//!
//! ```rust,no_run
//! use kkrpc_interop::{Client, StdioTransport, Arg};
//! use serde_json::json;
//! use std::process::{Command, Stdio};
//! use std::sync::Arc;
//!
//! // Spawn a server process
//! let mut child = Command::new("bun")
//!     .arg("server.ts")
//!     .stdin(Stdio::piped())
//!     .stdout(Stdio::piped())
//!     .spawn()
//!     .expect("spawn server");
//!
//! let stdout = child.stdout.take().expect("stdout");
//! let stdin = child.stdin.take().expect("stdin");
//!
//! // Create transport and client
//! let transport = StdioTransport::new(stdout, stdin);
//! let client = Arc::new(Client::new(Arc::new(transport)));
//!
//! // Call remote method
//! let result = client.call(
//!     "math.add",
//!     vec![Arg::Value(json!(1)), Arg::Value(json!(2))]
//! ).expect("call failed");
//!
//! println!("Result: {}", result);
//! ```
//!
//! ### Server Example
//!
//! ```rust,no_run
//! use kkrpc_interop::{Server, RpcApi, StdioTransport, Arg};
//! use serde_json::Value;
//! use std::sync::Arc;
//!
//! // Create API
//! let mut api = RpcApi::new();
//! api.register_method("math.add", Arc::new(|args: Vec<Arg>| {
//!     let a = match &args[0] {
//!         Arg::Value(v) => v.as_i64().unwrap_or(0),
//!         _ => 0,
//!     };
//!     let b = match &args[1] {
//!         Arg::Value(v) => v.as_i64().unwrap_or(0),
//!         _ => 0,
//!     };
//!     Value::from(a + b)
//! }));
//!
//! // Start server
//! let transport = Arc::new(StdioTransport::new(
//!     std::io::stdin(),
//!     std::io::stdout()
//! ));
//! let _server = Server::new(transport, api);
//!
//! // Keep server running
//! loop {
//!     std::thread::park();
//! }
//! ```
//!
//! ## Protocol
//!
//! The kkrpc protocol uses JSON messages with the following structure:
//!
//! ### Request
//! ```json
//! {
//!   "id": "uuid",
//!   "method": "math.add",
//!   "args": [1, 2],
//!   "type": "request",
//!   "version": "json"
//! }
//! ```
//!
//! ### Response
//! ```json
//! {
//!   "id": "uuid",
//!   "method": "",
//!   "args": {"result": 3},
//!   "type": "response",
//!   "version": "json"
//! }
//! ```
//!
//! ### Property Get
//! ```json
//! {
//!   "id": "uuid",
//!   "path": ["settings", "theme"],
//!   "type": "get",
//!   "version": "json"
//! }
//! ```
//!
//! ### Callback
//! Callbacks are encoded as `__callback__<id>` strings and invoked via:
//! ```json
//! {
//!   "id": "uuid",
//!   "method": "callback-id",
//!   "args": ["payload"],
//!   "type": "callback",
//!   "version": "json"
//! }
//! ```

use rand::Rng;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

/// Prefix for callback identifiers in the protocol.
///
/// Callback arguments are encoded as `__callback__<uuid>` strings.
/// When the remote side invokes the callback, it sends a message
/// with `type: "callback"` and the callback ID in the `method` field.
pub const CALLBACK_PREFIX: &str = "__callback__";

/// Transport layer abstraction for the RPC protocol.
///
/// This trait defines the interface for different transport implementations
/// (stdio, WebSocket, etc.). All transports must be thread-safe (`Send + Sync`).
///
/// # Example
///
/// ```rust
/// use kkrpc_interop::Transport;
///
/// struct MyTransport;
///
/// impl Transport for MyTransport {
///     fn read(&self) -> Option<String> {
///         // Read a line from the transport
///         None
///     }
///
///     fn write(&self, message: &str) -> Result<(), String> {
///         // Write a line to the transport
///         Ok(())
///     }
///
///     fn close(&self) {
///         // Close the transport
///     }
/// }
/// ```
pub trait Transport: Send + Sync {
    /// Read a message from the transport.
    ///
    /// Returns `None` if the transport is closed or an error occurs.
    fn read(&self) -> Option<String>;

    /// Write a message to the transport.
    ///
    /// The message should already include any necessary framing
    /// (e.g., newline for line-delimited protocols).
    fn write(&self, message: &str) -> Result<(), String>;

    /// Close the transport.
    ///
    /// This should gracefully shut down the transport and release resources.
    fn close(&self);
}

/// stdio-based transport implementation.
///
/// This transport reads from a reader and writes to a writer,
/// typically `stdin`/`stdout` or pipes to a child process.
///
/// # Type Parameters
///
/// - `R`: The reader type (e.g., `std::io::Stdin`, `ChildStdout`)
/// - `W`: The writer type (e.g., `std::io::Stdout`, `ChildStdin`)
///
/// # Example
///
/// ```rust,no_run
/// use kkrpc_interop::StdioTransport;
/// use std::process::{Command, Stdio};
///
/// let mut child = Command::new("server")
///     .stdin(Stdio::piped())
///     .stdout(Stdio::piped())
///     .spawn()
///     .unwrap();
///
/// let transport = StdioTransport::new(
///     child.stdout.take().unwrap(),
///     child.stdin.take().unwrap()
/// );
/// ```
pub struct StdioTransport<R: std::io::Read + Send + 'static, W: Write + Send + 'static> {
    reader: Mutex<BufReader<R>>,
    writer: Mutex<W>,
}

impl<R: std::io::Read + Send + 'static, W: Write + Send + 'static> StdioTransport<R, W> {
    /// Create a new stdio transport.
    ///
    /// # Arguments
    ///
    /// * `reader` - The source to read messages from
    /// * `writer` - The sink to write messages to
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

/// WebSocket transport implementation.
///
/// This transport communicates over WebSocket connections.
/// It uses a background thread to read messages and a condition
/// variable to notify the main thread of new messages.
///
/// # Example
///
/// ```rust,no_run
/// use kkrpc_interop::WebSocketTransport;
/// use std::sync::Arc;
///
/// let transport = WebSocketTransport::connect("ws://localhost:8789")
///     .expect("failed to connect");
/// ```
pub struct WebSocketTransport {
    sender: Mutex<websocket::sender::Writer<std::net::TcpStream>>,
    queue: Arc<(Mutex<VecDeque<String>>, Condvar)>,
}

impl WebSocketTransport {
    /// Connect to a WebSocket server.
    ///
    /// # Arguments
    ///
    /// * `url` - The WebSocket URL (e.g., "ws://localhost:8789")
    ///
    /// # Returns
    ///
    /// Returns an `Arc<WebSocketTransport>` on success, or an error string on failure.
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// use kkrpc_interop::WebSocketTransport;
    ///
    /// let transport = WebSocketTransport::connect("ws://localhost:8789")
    ///     .expect("connection failed");
    /// ```
    pub fn connect(url: &str) -> Result<Arc<Self>, String> {
        let client = websocket::ClientBuilder::new(url)
            .map_err(|err| err.to_string())?
            .connect_insecure()
            .map_err(|err| err.to_string())?;
        let (mut receiver, sender) = client.split().map_err(|err| err.to_string())?;
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

/// Error type for RPC operations.
///
/// This error type preserves the name, message, and additional data
/// from errors sent by the remote side.
///
/// # Example
///
/// ```rust
/// use kkrpc_interop::RpcError;
///
/// let error = RpcError {
///     name: Some("ValidationError".to_string()),
///     message: "Invalid input".to_string(),
///     data: serde_json::json!({"field": "username"}),
/// };
///
/// println!("Error: {}", error);
/// ```
#[derive(Debug)]
pub struct RpcError {
    /// The error type name (e.g., "ValidationError", "NotFound")
    pub name: Option<String>,
    /// The error message
    pub message: String,
    /// Additional error data (e.g., stack trace, error details)
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

/// Argument type for RPC method calls.
///
/// Arguments can be either JSON values or callbacks.
/// Callbacks are automatically encoded with the `__callback__` prefix.
///
/// # Example
///
/// ```rust
/// use kkrpc_interop::Arg;
/// use serde_json::json;
/// use std::sync::Arc;
///
/// // Value argument
/// let value_arg = Arg::Value(json!(42));
///
/// // Callback argument
/// let callback_arg = Arg::Callback(Arc::new(|args| {
///     println!("Callback invoked with: {:?}", args);
/// }));
/// ```
pub enum Arg {
    /// A JSON value argument
    Value(Value),
    /// A callback function argument
    Callback(Callback),
}

type Callback = Arc<dyn Fn(Vec<Value>) + Send + Sync + 'static>;

/// RPC client for making remote procedure calls.
///
/// The client is thread-safe and can be shared across threads using `Arc`.
/// It maintains a background thread for reading responses and callbacks.
///
/// # Example
///
/// ```rust,no_run
/// use kkrpc_interop::{Client, StdioTransport, Arg};
/// use serde_json::json;
/// use std::process::{Command, Stdio};
/// use std::sync::Arc;
///
/// let child = Command::new("server")
///     .stdin(Stdio::piped())
///     .stdout(Stdio::piped())
///     .spawn()
///     .unwrap();
///
/// let transport = StdioTransport::new(
///     child.stdout.unwrap(),
///     child.stdin.unwrap()
/// );
/// let client = Arc::new(Client::new(Arc::new(transport)));
///
/// // Make a call
/// let result = client.call(
///     "add",
///     vec![Arg::Value(json!(1)), Arg::Value(json!(2))]
/// ).unwrap();
/// ```
pub struct Client {
    transport: Arc<dyn Transport>,
    pending: Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<ResponsePayload>>>>,
    callbacks: Arc<Mutex<HashMap<String, Callback>>>,
}

impl Client {
    /// Create a new RPC client.
    ///
    /// This spawns a background thread that continuously reads messages
    /// from the transport and dispatches them to waiting callers or callbacks.
    ///
    /// # Arguments
    ///
    /// * `transport` - The transport to use for communication
    ///
    /// # Returns
    ///
    /// A new `Client` instance
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// use kkrpc_interop::{Client, StdioTransport};
    /// use std::io;
    /// use std::sync::Arc;
    ///
    /// let transport = StdioTransport::new(io::stdin(), io::stdout());
    /// let client = Client::new(Arc::new(transport));
    /// ```
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

    /// Call a remote method.
    ///
    /// # Arguments
    ///
    /// * `method` - The method name (e.g., "math.add")
    /// * `args` - The method arguments
    ///
    /// # Returns
    ///
    /// The method result on success, or an [`RpcError`] on failure
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// use kkrpc_interop::{Client, Arg};
    /// use serde_json::json;
    ///
    /// fn example(client: &Client) {
    ///     let result = client.call(
    ///         "math.add",
    ///         vec![Arg::Value(json!(1)), Arg::Value(json!(2))]
    ///     ).expect("call failed");
    ///     
    ///     println!("Result: {}", result);
    /// }
    /// ```
    pub fn call(&self, method: &str, args: Vec<Arg>) -> Result<Value, RpcError> {
        self.send_request("request", Some(method), args, None, None)
    }

    /// Get a property value from the remote API.
    ///
    /// # Arguments
    ///
    /// * `path` - The property path as an array of strings
    ///
    /// # Returns
    ///
    /// The property value on success, or an [`RpcError`] on failure
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// use kkrpc_interop::Client;
    ///
    /// fn example(client: &Client) {
    ///     let counter = client.get(&["counter"]).expect("get failed");
    ///     let theme = client.get(&["settings", "theme"]).expect("get failed");
    ///     
    ///     println!("Counter: {}, Theme: {}", counter, theme);
    /// }
    /// ```
    pub fn get(&self, path: &[&str]) -> Result<Value, RpcError> {
        let path_values: Vec<Value> = path.iter().map(|s| Value::String(s.to_string())).collect();
        self.send_request("get", None, vec![], Some(path_values), None)
    }

    /// Set a property value on the remote API.
    ///
    /// # Arguments
    ///
    /// * `path` - The property path as an array of strings
    /// * `value` - The value to set
    ///
    /// # Returns
    ///
    /// `true` on success, or an [`RpcError`] on failure
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// use kkrpc_interop::Client;
    /// use serde_json::json;
    ///
    /// fn example(client: &Client) {
    ///     client.set(&["settings", "theme"],
    ///         json!("dark")
    ///     ).expect("set failed");
    /// }
    /// ```
    pub fn set(&self, path: &[&str], value: Value) -> Result<Value, RpcError> {
        let path_values: Vec<Value> = path.iter().map(|s| Value::String(s.to_string())).collect();
        self.send_request("set", None, vec![], Some(path_values), Some(value))
    }

    fn send_request(
        &self,
        message_type: &str,
        method: Option<&str>,
        args: Vec<Arg>,
        path: Option<Vec<Value>>,
        value: Option<Value>,
    ) -> Result<Value, RpcError> {
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
        payload.insert("type".to_string(), Value::String(message_type.to_string()));
        payload.insert("version".to_string(), Value::String("json".to_string()));
        if let Some(m) = method {
            payload.insert("method".to_string(), Value::String(m.to_string()));
        }
        if !processed_args.is_empty() {
            payload.insert("args".to_string(), Value::Array(processed_args));
        }
        if !callback_ids.is_empty() {
            payload.insert("callbackIds".to_string(), Value::Array(callback_ids));
        }
        if let Some(p) = path {
            payload.insert("path".to_string(), Value::Array(p));
        }
        if let Some(v) = value {
            payload.insert("value".to_string(), v);
        }

        write_message(&self.transport, Value::Object(payload));

        let response = receiver.recv().expect("response received");
        if let Some(error) = response.error {
            return Err(error);
        }
        Ok(response.result.unwrap_or(Value::Null))
    }

    /// Close the client transport.
    ///
    /// This gracefully shuts down the transport connection.
    pub fn close(&self) {
        self.transport.close();
    }
}

/// Handler type for RPC methods.
///
/// Handlers receive a vector of [`Arg`] and return a JSON [`Value`].
/// They must be thread-safe (`Send + Sync`) and have a `'static` lifetime.
///
/// # Example
///
/// ```rust
/// use kkrpc_interop::{Handler, Arg};
/// use serde_json::Value;
/// use std::sync::Arc;
///
/// let handler: Handler = Arc::new(|args: Vec<Arg>| {
///     // Extract arguments
///     let a = match &args.get(0) {
///         Some(Arg::Value(v)) => v.as_i64().unwrap_or(0),
///         _ => 0,
///     };
///     let b = match &args.get(1) {
///         Some(Arg::Value(v)) => v.as_i64().unwrap_or(0),
///         _ => 0,
///     };
///     
///     // Return result
///     Value::from(a + b)
/// });
/// ```
pub type Handler = Arc<dyn Fn(Vec<Arg>) -> Value + Send + Sync + 'static>;

/// API registry for the RPC server.
///
/// This struct holds all registered methods and their handlers.
/// Use [`RpcApi::register_method`] to add methods.
///
/// # Example
///
/// ```rust
/// use kkrpc_interop::RpcApi;
/// use serde_json::Value;
/// use std::sync::Arc;
///
/// let mut api = RpcApi::new();
/// api.register_method("add", Arc::new(|args| {
///     Value::from(42)
/// }));
/// ```
#[derive(Default)]
pub struct RpcApi {
    data: Arc<Mutex<HashMap<String, Value>>>,
    methods: HashMap<String, Handler>,
    constructors: HashMap<String, Handler>,
}

impl RpcApi {
    /// Create a new empty API registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a method handler.
    ///
    /// # Arguments
    ///
    /// * `name` - The method name (e.g., "math.add")
    /// * `handler` - The handler function
    ///
    /// # Example
    ///
    /// ```rust
    /// use kkrpc_interop::{RpcApi, Arg};
    /// use serde_json::Value;
    /// use std::sync::Arc;
    ///
    /// let mut api = RpcApi::new();
    /// api.register_method("add", Arc::new(|args| {
    ///     let a = match &args[0] {
    ///         Arg::Value(v) => v.as_i64().unwrap_or(0),
    ///         _ => 0,
    ///     };
    ///     let b = match &args[1] {
    ///         Arg::Value(v) => v.as_i64().unwrap_or(0),
    ///         _ => 0,
    ///     };
    ///     Value::from(a + b)
    /// }));
    /// ```
    pub fn register_method(&mut self, name: &str, handler: Handler) {
        self.methods.insert(name.to_string(), handler);
    }

    /// Register a constructor handler.
    ///
    /// Constructors are special methods used for object instantiation.
    ///
    /// # Arguments
    ///
    /// * `name` - The constructor name
    /// * `handler` - The handler function
    pub fn register_constructor(&mut self, name: &str, handler: Handler) {
        self.constructors.insert(name.to_string(), handler);
    }

    /// Set a value in the API data store.
    ///
    /// # Arguments
    ///
    /// * `path` - The value path (dot-separated)
    /// * `value` - The value to store
    pub fn set_value(&self, path: &str, value: Value) {
        let mut data = self.data.lock().expect("data lock");
        data.insert(path.to_string(), value);
    }

    fn get_value(&self, path: &str) -> Option<Value> {
        self.data.lock().expect("data lock").get(path).cloned()
    }
}

/// RPC server that handles incoming requests.
///
/// The server spawns a background thread that continuously reads messages
/// from the transport and dispatches them to the appropriate handlers.
///
/// # Example
///
/// ```rust,no_run
/// use kkrpc_interop::{Server, RpcApi, StdioTransport};
/// use std::io;
/// use std::sync::Arc;
///
/// let mut api = RpcApi::new();
/// // ... register methods ...
///
/// let transport = Arc::new(StdioTransport::new(io::stdin(), io::stdout()));
/// let _server = Server::new(transport, api);
///
/// // Keep running
/// loop {
///     std::thread::park();
/// }
/// ```
pub struct Server {
    transport: Arc<dyn Transport>,
    api: Arc<RpcApi>,
}

impl Server {
    /// Create and start a new RPC server.
    ///
    /// This spawns a background thread that handles incoming requests.
    ///
    /// # Arguments
    ///
    /// * `transport` - The transport to listen on
    /// * `api` - The API registry with registered methods
    ///
    /// # Returns
    ///
    /// A new `Server` instance
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

/// Generate a UUID for request/callback identification.
///
/// This generates a simple random UUID-like string.
/// Format: `xxxxxxxx-xxxx-xxxx-xxxx` (4 hex parts)
///
/// # Returns
///
/// A random UUID string
pub fn generate_uuid() -> String {
    let mut rng = rand::thread_rng();
    let parts: Vec<String> = (0..4)
        .map(|_| format!("{:x}", rng.r#gen::<u64>()))
        .collect();
    parts.join("-")
}
