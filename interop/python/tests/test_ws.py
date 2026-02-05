import os
import subprocess
import threading
import time

from kkrpc import RpcClient, WebSocketTransport


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SERVER_PATH = os.path.join(ROOT, "interop", "node", "ws-server.ts")


def test_ws_calls() -> None:
	port = "8789"
	process = subprocess.Popen(
		["bun", SERVER_PATH],
		stdin=subprocess.PIPE,
		stdout=subprocess.PIPE,
		stderr=subprocess.PIPE,
		text=True,
		cwd=ROOT,
		env={**os.environ, "PORT": port}
	)

	try:
		# Give the server a moment to start
		time.sleep(0.2)
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
