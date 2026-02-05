import os
import subprocess
import threading
import time

from kkrpc import RpcClient


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SERVER_PATH = os.path.join(ROOT, "interop", "node", "server.ts")


def main() -> int:
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

	client = RpcClient(process.stdout, process.stdin)

	try:
		result = client.call("math.add", 2, 3)
		assert result == 5, f"unexpected add result {result}"
		print(f"[python] math.add(2, 3) => {result}")

		echo_value = {"name": "kkrpc", "count": 1}
		echo_result = client.call("echo", echo_value)
		assert echo_result == echo_value, f"unexpected echo result {echo_result}"
		print(f"[python] echo({echo_value}) => {echo_result}")

		callback_event = threading.Event()
		callback_payload = {}

		def on_callback(value: str) -> None:
			callback_payload["value"] = value
			callback_event.set()

		callback_result = client.call("withCallback", "ping", on_callback)
		assert callback_result == "callback-sent"
		print(f"[python] withCallback('ping', cb) => {callback_result}")

		if not callback_event.wait(timeout=2):
			raise RuntimeError("callback not received")
		assert callback_payload["value"] == "callback:ping"
		print(f"[python] callback received => {callback_payload['value']}")
	finally:
		client.close()
		process.terminate()
		try:
			process.wait(timeout=5)
		except subprocess.TimeoutExpired:
			process.kill()

	stderr = process.stderr.read() if process.stderr else ""
	if stderr.strip():
		print(stderr)

	return 0


if __name__ == "__main__":
	raise SystemExit(main())
