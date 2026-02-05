use kkrpc_interop::{Arg, Client, StdioTransport};
use serde_json::json;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[test]
fn stdio_client_calls() {
    let root = std::env::current_dir().expect("cwd");
    let server_path = root.join("../node/server.ts");

    let mut child = Command::new("bun")
        .arg(server_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn bun server");

    let stdout = child.stdout.take().expect("stdout");
    let stdin = child.stdin.take().expect("stdin");

    let transport = StdioTransport::new(stdout, stdin);
    let client = Client::new(std::sync::Arc::new(transport));

    let result = client
        .call("math.add", vec![Arg::Value(json!(3)), Arg::Value(json!(6))])
        .expect("call math.add");
    assert_eq!(result.as_i64(), Some(9));

    let echo_input = json!({"name": "kkrpc", "count": 3});
    let echo_result = client
        .call("echo", vec![Arg::Value(echo_input.clone())])
        .expect("call echo");
    assert_eq!(echo_result, echo_input);

    let (callback_sender, callback_receiver) = mpsc::channel::<String>();
    let callback = move |args: Vec<serde_json::Value>| {
        if let Some(first) = args.get(0) {
            let _ = callback_sender.send(first.as_str().unwrap_or("").to_string());
        }
    };

    let callback_result = client
        .call(
            "withCallback",
            vec![
                Arg::Value(json!("pong")),
                Arg::Callback(std::sync::Arc::new(callback)),
            ],
        )
        .expect("call withCallback");
    assert_eq!(callback_result.as_str(), Some("callback-sent"));

    let callback_value = callback_receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("callback received");
    assert_eq!(callback_value, "callback:pong");

    let _ = child.kill();
    let _ = child.wait();
}
