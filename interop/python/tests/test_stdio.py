import os
import subprocess
import threading

from kkrpc import RpcClient, StdioTransport


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SERVER_PATH = os.path.join(ROOT, "interop", "node", "server.ts")


def test_stdio_calls() -> None:
	process = subprocess.Popen(
		["bun", SERVER_PATH],
		stdin=subprocess.PIPE,
		stdout=subprocess.PIPE,
		stderr=subprocess.PIPE,
		text=True,
		cwd=ROOT
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
