import os
import subprocess
import threading
import time
from typing import Optional

from kkrpc import ARG_ENVELOPE_TAG, RpcClient, RpcServer, StdioTransport
from kkrpc.protocol import decode_message, encode_message


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SERVER_PATH = os.path.join(ROOT, "interop", "node", "server.ts")


class MemoryTransport:
    def __init__(self) -> None:
        self.inbox: list[str] = []
        self.outbox: list[str] = []
        self.closed = False

    def read(self) -> Optional[str]:
        while not self.inbox and not self.closed:
            pass
        if self.closed:
            return None
        return self.inbox.pop(0)

    def write(self, message: str) -> None:
        self.outbox.append(message)

    def close(self) -> None:
        self.closed = True


def test_server_unwraps_stable_value_envelope_args() -> None:
    transport = MemoryTransport()
    server = RpcServer(transport, {"echo": lambda value: value})

    transport.inbox.append(
        encode_message(
            {
                "t": "q",
                "id": "value-envelope",
                "op": "call",
                "p": ["echo"],
                "a": [{ARG_ENVELOPE_TAG: "value", "v": "payload"}],
            }
        )
    )

    for _ in range(10000):
        if transport.outbox:
            break
        time.sleep(0.001)

    server.close()
    assert transport.outbox
    response = decode_message(transport.outbox[0])
    assert response["v"] == "payload"


def test_client_sends_null_set_values() -> None:
    transport = MemoryTransport()
    client = RpcClient(transport)
    result: dict[str, object] = {}

    def set_value() -> None:
        result["value"] = client.set(["settings", "theme"], None)

    thread = threading.Thread(target=set_value)
    thread.start()

    for _ in range(10000):
        if transport.outbox:
            break
        time.sleep(0.001)

    assert transport.outbox
    request = decode_message(transport.outbox[0])
    assert "v" in request
    assert request["v"] is None
    transport.inbox.append(encode_message({"t": "r", "id": request["id"], "v": True}))
    thread.join(timeout=2)

    client.close()
    assert result["value"] is True


def test_stdio_calls() -> None:
    process = subprocess.Popen(
        ["bun", SERVER_PATH],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=ROOT,
    )
    assert process.stdin is not None
    assert process.stdout is not None

    transport = StdioTransport(process.stdout, process.stdin)
    client = RpcClient(transport)

    try:
        result = client.call("math.add", 2, 3)
        assert result == 5

        echo_value = {"name": "kkrpc", "count": 1}
        echo_result = client.call("echo", echo_value)
        assert echo_result == echo_value

        callback_event = threading.Event()
        callback_payload = {}

        def on_callback(value: str) -> None:
            callback_payload["value"] = value
            callback_event.set()

        callback_result = client.call("withCallback", "ping", on_callback)
        assert callback_result == "callback-sent"

        assert callback_event.wait(timeout=2)
        assert callback_payload["value"] == "callback:ping"
    finally:
        client.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def test_stdio_property_access() -> None:
    process = subprocess.Popen(
        ["bun", SERVER_PATH],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=ROOT,
    )
    assert process.stdin is not None
    assert process.stdout is not None

    transport = StdioTransport(process.stdout, process.stdin)
    client = RpcClient(transport)

    try:
        counter = client.get(["counter"])
        assert counter == 42

        theme = client.get(["settings", "theme"])
        assert theme == "light"

        notifications_enabled = client.get(["settings", "notifications", "enabled"])
        assert notifications_enabled is True

        client.set(["settings", "theme"], "dark")
        new_theme = client.get(["settings", "theme"])
        assert new_theme == "dark"
    finally:
        client.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def test_stdio_concurrent_calls() -> None:
    process = subprocess.Popen(
        ["bun", SERVER_PATH],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=ROOT,
    )
    assert process.stdin is not None
    assert process.stdout is not None

    transport = StdioTransport(process.stdout, process.stdin)
    client = RpcClient(transport)

    try:
        results = []
        errors = []

        def make_call(a: int, b: int) -> None:
            try:
                result = client.call("math.add", a, b)
                results.append((a, b, result))
            except Exception as e:
                errors.append(e)

        threads = []
        for i in range(20):
            t = threading.Thread(target=make_call, args=(i, i + 1))
            threads.append(t)
            t.start()

        for t in threads:
            t.join(timeout=10)

        assert len(errors) == 0, f"Concurrent calls failed: {errors}"
        assert len(results) == 20

        for a, b, result in results:
            assert result == a + b, f"Expected {a + b}, got {result}"
    finally:
        client.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
