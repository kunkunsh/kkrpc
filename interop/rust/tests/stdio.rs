use kkrpc::{Arg, Client, StdioTransport};
use serde_json::json;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
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
    let client = Arc::new(Client::new(Arc::new(transport)));

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
            vec![Arg::Value(json!("pong")), Arg::Callback(Arc::new(callback))],
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

#[test]
fn stdio_property_access() {
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
    let client = Arc::new(Client::new(Arc::new(transport)));

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

#[test]
fn stdio_concurrent_calls() {
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
    let client = Arc::new(Client::new(Arc::new(transport)));

    let (tx, rx) = mpsc::channel::<Result<i64, String>>();

    for i in 0..20 {
        let tx = tx.clone();
        let client_clone = Arc::clone(&client);
        thread::spawn(move || {
            let result = client_clone.call(
                "math.add",
                vec![Arg::Value(json!(i)), Arg::Value(json!(i + 1))],
            );
            match result {
                Ok(value) => {
                    let _ = tx.send(Ok(value.as_i64().unwrap_or(0)));
                }
                Err(e) => {
                    let _ = tx.send(Err(e.to_string()));
                }
            }
        });
    }

    drop(tx);

    let mut success_count = 0;
    let mut error_count = 0;

    for result in rx {
        match result {
            Ok(sum) => {
                success_count += 1;
                assert!(sum > 0);
            }
            Err(_) => {
                error_count += 1;
            }
        }
    }

    assert_eq!(error_count, 0, "Some concurrent calls failed");
    assert_eq!(success_count, 20, "Expected 20 successful calls");

    let _ = child.kill();
    let _ = child.wait();
}
