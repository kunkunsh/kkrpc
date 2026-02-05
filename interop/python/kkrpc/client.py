import queue
import threading
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional

from .adapters.base import Transport
from .protocol import CALLBACK_PREFIX, decode_message, encode_message, generate_uuid


class RpcError(RuntimeError):
	def __init__(self, message: str, name: Optional[str] = None, data: Any = None) -> None:
		super().__init__(message)
		self.name = name
		self.data = data


@dataclass
class PendingRequest:
	queue: "queue.Queue[Any]"


class RpcClient:
	def __init__(self, transport: Transport) -> None:
		self._transport = transport
		self._pending: Dict[str, PendingRequest] = {}
		self._callbacks: Dict[str, Callable[..., Any]] = {}
		self._lock = threading.Lock()
		self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
		self._reader_thread.start()

	def call(self, method: str, *args: Any) -> Any:
		return self._send_request("request", method=method, args=list(args))

	def get(self, path: Iterable[str]) -> Any:
		return self._send_request("get", path=list(path))

	def set(self, path: Iterable[str], value: Any) -> Any:
		return self._send_request("set", path=list(path), value=value)

	def construct(self, method: str, *args: Any) -> Any:
		return self._send_request("construct", method=method, args=list(args))

	def close(self) -> None:
		self._transport.close()

	def _send_request(
		self,
		message_type: str,
		method: str = "",
		args: Optional[List[Any]] = None,
		path: Optional[List[str]] = None,
		value: Any = None
	) -> Any:
		request_id = generate_uuid()
		pending = PendingRequest(queue=queue.Queue(maxsize=1))
		self._pending[request_id] = pending
		callback_ids: List[str] = []

		processed_args: List[Any] = []
		if args is not None:
			for arg in args:
				if callable(arg):
					callback_id = generate_uuid()
					self._callbacks[callback_id] = arg
					callback_ids.append(callback_id)
					processed_args.append(f"{CALLBACK_PREFIX}{callback_id}")
				else:
					processed_args.append(arg)

		payload: Dict[str, Any] = {
			"id": request_id,
			"method": method,
			"args": processed_args,
			"type": message_type,
			"version": "json"
		}

		if callback_ids:
			payload["callbackIds"] = callback_ids
		if path is not None:
			payload["path"] = path
		if value is not None:
			payload["value"] = value

		self._write_message(payload)
		response = pending.queue.get()
		if isinstance(response, Exception):
			raise response
		return response

	def _write_message(self, payload: Dict[str, Any]) -> None:
		line = encode_message(payload)
		with self._lock:
			self._transport.write(line)

	def _read_loop(self) -> None:
		while True:
			line = self._transport.read()
			if line is None:
				break
			line = line.strip()
			if not line:
				continue
			try:
				message = decode_message(line)
			except ValueError:
				continue
			self._handle_message(message)

	def _handle_message(self, message: Dict[str, Any]) -> None:
		message_type = message.get("type")
		if message_type == "response":
			self._handle_response(message)
		elif message_type == "callback":
			self._handle_callback(message)

	def _handle_response(self, message: Dict[str, Any]) -> None:
		request_id = message.get("id")
		pending = self._pending.pop(request_id, None)
		if not pending:
			return
		args = message.get("args", {})
		if isinstance(args, dict) and "error" in args:
			error_value = args.get("error")
			if isinstance(error_value, dict):
				pending.queue.put(
					RpcError(
						error_value.get("message", "RPC error"),
						name=error_value.get("name"),
						data=error_value
					)
				)
			else:
				pending.queue.put(RpcError(str(error_value)))
			return
		pending.queue.put(args.get("result"))

	def _handle_callback(self, message: Dict[str, Any]) -> None:
		callback_id = message.get("method")
		callback = self._callbacks.get(callback_id)
		if not callback:
			return
		args = message.get("args")
		if not isinstance(args, list):
			args = []
		callback(*args)
