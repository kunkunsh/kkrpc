import json
import queue
import random
import threading
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional, TextIO


CALLBACK_PREFIX = "__callback__"


def generate_uuid() -> str:
	return "-".join(f"{random.getrandbits(53):x}" for _ in range(4))


class RpcError(RuntimeError):
	def __init__(self, message: str, name: Optional[str] = None, data: Any = None) -> None:
		super().__init__(message)
		self.name = name
		self.data = data


@dataclass
class PendingRequest:
	queue: "queue.Queue[Any]"


class RpcClient:
	def __init__(self, reader: TextIO, writer: TextIO) -> None:
		self._reader = reader
		self._writer = writer
		self._pending: Dict[str, PendingRequest] = {}
		self._callbacks: Dict[str, Callable[..., Any]] = {}
		self._lock = threading.Lock()
		self._buffer = ""
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
		try:
			self._writer.close()
		except OSError:
			pass

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
		line = json.dumps(payload, ensure_ascii=False)
		with self._lock:
			self._writer.write(f"{line}\n")
			self._writer.flush()

	def _read_loop(self) -> None:
		for line in self._reader:
			line = line.strip()
			if not line:
				continue
			try:
				message = json.loads(line)
			except json.JSONDecodeError:
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


class RpcServer:
	def __init__(self, reader: TextIO, writer: TextIO, api: Dict[str, Any]) -> None:
		self._reader = reader
		self._writer = writer
		self._api = api
		self._lock = threading.Lock()
		self._buffer = ""
		self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
		self._reader_thread.start()

	def _write_message(self, payload: Dict[str, Any]) -> None:
		line = json.dumps(payload, ensure_ascii=False)
		with self._lock:
			self._writer.write(f"{line}\n")
			self._writer.flush()

	def _read_loop(self) -> None:
		for line in self._reader:
			line = line.strip()
			if not line:
				continue
			try:
				message = json.loads(line)
			except json.JSONDecodeError:
				continue
			self._handle_message(message)

	def _handle_message(self, message: Dict[str, Any]) -> None:
		message_type = message.get("type")
		if message_type == "request":
			self._handle_request(message)
		elif message_type == "get":
			self._handle_get(message)
		elif message_type == "set":
			self._handle_set(message)
		elif message_type == "construct":
			self._handle_construct(message)

	def _resolve_path(self, path: List[str]) -> Any:
		target: Any = self._api
		for part in path:
			if not isinstance(target, dict) or part not in target:
				raise KeyError(".".join(path))
			target = target[part]
		return target

	def _wrap_callbacks(self, args: List[Any], request_id: str) -> List[Any]:
		processed: List[Any] = []
		for arg in args:
			if isinstance(arg, str) and arg.startswith(CALLBACK_PREFIX):
				callback_id = arg[len(CALLBACK_PREFIX) :]

				def _callback(*callback_args: Any) -> None:
					self._write_message(
						{
							"id": request_id,
							"method": callback_id,
							"args": list(callback_args),
							"type": "callback",
							"version": "json"
						}
					)

				processed.append(_callback)
			else:
				processed.append(arg)
		return processed

	def _send_response(self, request_id: str, result: Any) -> None:
		self._write_message(
			{
				"id": request_id,
				"method": "",
				"args": {"result": result},
				"type": "response",
				"version": "json"
			}
		)

	def _send_error(self, request_id: str, error: Exception) -> None:
		self._write_message(
			{
				"id": request_id,
				"method": "",
				"args": {
					"error": {
						"name": error.__class__.__name__,
						"message": str(error)
					}
				},
				"type": "response",
				"version": "json"
			}
		)

	def _handle_request(self, message: Dict[str, Any]) -> None:
		request_id = message.get("id", "")
		method = message.get("method", "")
		args = message.get("args")
		if not isinstance(args, list):
			args = []
		try:
			path = method.split(".") if method else []
			target = self._resolve_path(path)
			if not callable(target):
				raise TypeError(f"Method {method} is not callable")
			result = target(*self._wrap_callbacks(args, request_id))
			self._send_response(request_id, result)
		except Exception as error:
			self._send_error(request_id, error)

	def _handle_get(self, message: Dict[str, Any]) -> None:
		request_id = message.get("id", "")
		path = message.get("path")
		if not isinstance(path, list):
			self._send_error(request_id, ValueError("Missing path"))
			return
		try:
			result = self._resolve_path(path)
			self._send_response(request_id, result)
		except Exception as error:
			self._send_error(request_id, error)

	def _handle_set(self, message: Dict[str, Any]) -> None:
		request_id = message.get("id", "")
		path = message.get("path")
		if not isinstance(path, list) or not path:
			self._send_error(request_id, ValueError("Missing path"))
			return
		try:
			parent = self._resolve_path(path[:-1])
			if not isinstance(parent, dict):
				raise TypeError("Set target is not an object")
			parent[path[-1]] = message.get("value")
			self._send_response(request_id, True)
		except Exception as error:
			self._send_error(request_id, error)

	def _handle_construct(self, message: Dict[str, Any]) -> None:
		request_id = message.get("id", "")
		method = message.get("method", "")
		args = message.get("args")
		if not isinstance(args, list):
			args = []
		try:
			path = method.split(".") if method else []
			constructor = self._resolve_path(path)
			if not callable(constructor):
				raise TypeError(f"Constructor {method} is not callable")
			result = constructor(*self._wrap_callbacks(args, request_id))
			self._send_response(request_id, result)
		except Exception as error:
			self._send_error(request_id, error)
