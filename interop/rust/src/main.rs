use serde_json::{json, Value};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use kkrpc_interop::{Arg, Client};

fn main() {
    let root = std::env::current_dir().expect("cwd");
    let server_path = root.join("interop").join("node").join("server.ts");

    let mut child = Command::new("bun")
        .arg(server_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn bun server");

    let stdout = child.stdout.take().expect("stdout");
    let stdin = child.stdin.take().expect("stdin");

    let client = Client::new(stdout, stdin);

    let result = client
        .call("math.add", vec![Arg::Value(json!(3)), Arg::Value(json!(6))])
        .expect("call math.add");
    assert_eq!(result.as_i64(), Some(9));
    println!("[rust] math.add(3, 6) => {}", result);

    let echo_input = json!({"name": "kkrpc", "count": 3});
    let echo_result = client
        .call("echo", vec![Arg::Value(echo_input.clone())])
        .expect("call echo");
    assert!(compare_maps(&echo_input, &echo_result));
    println!("[rust] echo({}) => {}", echo_input, echo_result);

    let (callback_sender, callback_receiver) = mpsc::channel::<String>();
    let callback = move |args: Vec<Value>| {
        if let Some(first) = args.get(0) {
            let _ = callback_sender.send(first.to_string().trim_matches('"').to_string());
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
    println!("[rust] withCallback(\"pong\", cb) => {}", callback_result);

    let callback_value = callback_receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("callback received");
    assert_eq!(callback_value, "callback:pong");
    println!("[rust] callback received => {}", callback_value);

    let _ = child.kill();
    let _ = child.wait();
}

fn compare_maps(expected: &Value, actual: &Value) -> bool {
    let expected_map = match expected.as_object() {
        Some(map) => map,
        None => return false,
    };
    let actual_map = match actual.as_object() {
        Some(map) => map,
        None => return false,
    };

    for (key, expected_value) in expected_map.iter() {
        let Some(actual_value) = actual_map.get(key) else {
            return false;
        };
        if !values_equal(expected_value, actual_value) {
            return false;
        }
    }

    true
}

fn values_equal(expected: &Value, actual: &Value) -> bool {
    match (expected, actual) {
        (Value::Number(expected_number), Value::Number(actual_number)) => {
            expected_number.as_f64() == actual_number.as_f64()
        }
        _ => expected == actual,
    }
}
