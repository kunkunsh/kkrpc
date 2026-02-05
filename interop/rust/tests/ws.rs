use kkrpc_interop::{Arg, Client, WebSocketTransport};
use serde_json::json;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

#[test]
fn websocket_client_calls() {
    let root = std::env::current_dir().expect("cwd");
    let server_path = root.join("../node/ws-server.ts");

    let mut child = Command::new("bun")
        .arg(server_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .env("PORT", "0")
        .spawn()
        .expect("spawn bun ws server");

    let stdout = child.stdout.take().expect("stdout");
    let reader = BufReader::new(stdout);
    let mut port = String::new();
    for line in reader.lines() {
        if let Ok(line) = line {
            if let Some(caps) = regex::Regex::new(r"listening on (\d+)")
                .unwrap()
                .captures(&line)
            {
                port = caps[1].to_string();
                break;
            }
        }
    }

    std::thread::sleep(Duration::from_millis(200));

    let transport =
        WebSocketTransport::connect(&format!("ws://localhost:{}", port)).expect("ws connect");
    let client = Arc::new(Client::new(transport));

    let result = client
        .call("math.add", vec![Arg::Value(json!(8)), Arg::Value(json!(9))])
        .expect("call math.add");
    assert_eq!(result.as_i64(), Some(17));

    let echo_input = json!({"name": "kkrpc", "count": 5});
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
            vec![Arg::Value(json!("ws")), Arg::Callback(Arc::new(callback))],
        )
        .expect("call withCallback");
    assert_eq!(callback_result.as_str(), Some("callback-sent"));

    let callback_value = callback_receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("callback received");
    assert_eq!(callback_value, "callback:ws");

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn websocket_property_access() {
    let root = std::env::current_dir().expect("cwd");
    let server_path = root.join("../node/ws-server.ts");

    let mut child = Command::new("bun")
        .arg(server_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .env("PORT", "0")
        .spawn()
        .expect("spawn bun ws server");

    let stdout = child.stdout.take().expect("stdout");
    let reader = BufReader::new(stdout);
    let mut port = String::new();
    for line in reader.lines() {
        if let Ok(line) = line {
            if let Some(caps) = regex::Regex::new(r"listening on (\d+)")
                .unwrap()
                .captures(&line)
            {
                port = caps[1].to_string();
                break;
            }
        }
    }

    std::thread::sleep(Duration::from_millis(200));

    let transport =
        WebSocketTransport::connect(&format!("ws://localhost:{}", port)).expect("ws connect");
    let client = Arc::new(Client::new(transport));

    let counter = client.get(&["counter"]).expect("get counter");
    assert_eq!(counter.as_i64(), Some(42));

    let theme = client.get(&["settings", "theme"]).expect("get theme");
    assert_eq!(theme.as_str(), Some("light"));

    let notifications_enabled = client
        .get(&["settings", "notifications", "enabled"])
        .expect("get notifications.enabled");
    assert_eq!(notifications_enabled.as_bool(), Some(true));

    client
        .set(&["settings", "theme"], json!("dark"))
        .expect("set theme");

    let new_theme = client.get(&["settings", "theme"]).expect("get new theme");
    assert_eq!(new_theme.as_str(), Some("dark"));

    let _ = child.kill();
    let _ = child.wait();
}
