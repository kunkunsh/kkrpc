import os
import re
import subprocess
import threading
import time

from kkrpc import RpcClient, WebSocketTransport


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SERVER_PATH = os.path.join(ROOT, "interop", "node", "ws-server.ts")


def test_ws_calls() -> None:
    process = subprocess.Popen(
        ["bun", SERVER_PATH],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=ROOT,
        env={**os.environ, "PORT": "0"},
    )

    try:
        start_time = time.time()
        port = None
        while time.time() - start_time < 5:
            line = process.stdout.readline() if process.stdout else ""
            if line:
                match = re.search(r"listening on (\d+)", line)
                if match:
                    port = match.group(1)
                    break
            time.sleep(0.01)

        if not port:
            raise RuntimeError("Failed to get server port")

        time.sleep(0.1)
        transport = WebSocketTransport(f"ws://localhost:{port}")
        client = RpcClient(transport)

        result = client.call("math.add", 5, 7)
        assert result == 12

        echo_value = {"name": "kkrpc", "count": 4}
        echo_result = client.call("echo", echo_value)
        assert echo_result == echo_value

        callback_event = threading.Event()
        callback_payload = {}

        def on_callback(value: str) -> None:
            callback_payload["value"] = value
            callback_event.set()

        callback_result = client.call("withCallback", "ws", on_callback)
        assert callback_result == "callback-sent"

        assert callback_event.wait(timeout=2)
        assert callback_payload["value"] == "callback:ws"
        client.close()
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def test_ws_property_access() -> None:
    process = subprocess.Popen(
        ["bun", SERVER_PATH],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=ROOT,
        env={**os.environ, "PORT": "0"},
    )

    try:
        start_time = time.time()
        port = None
        while time.time() - start_time < 5:
            line = process.stdout.readline() if process.stdout else ""
            if line:
                match = re.search(r"listening on (\d+)", line)
                if match:
                    port = match.group(1)
                    break
            time.sleep(0.01)

        if not port:
            raise RuntimeError("Failed to get server port")

        time.sleep(0.1)
        transport = WebSocketTransport(f"ws://localhost:{port}")
        client = RpcClient(transport)

        counter = client.get(["counter"])
        assert counter == 42

        theme = client.get(["settings", "theme"])
        assert theme == "light"

        notifications_enabled = client.get(["settings", "notifications", "enabled"])
        assert notifications_enabled is True

        client.set(["settings", "theme"], "dark")
        new_theme = client.get(["settings", "theme"])
        assert new_theme == "dark"

        client.close()
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
