import threading
from typing import Any, Dict, List

from .adapters.base import Transport
from .protocol import ARG_ENVELOPE_TAG, decode_message, encode_message


class RpcServer:
    def __init__(self, transport: Transport, api: Dict[str, Any]) -> None:
        self._transport = transport
        self._api = api
        self._lock = threading.Lock()
        self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
        self._reader_thread.start()

    def close(self) -> None:
        self._transport.close()

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
        if message.get("t") != "q":
            return
        operation = message.get("op")
        if operation == "call":
            self._handle_request(message)
        elif operation == "get":
            self._handle_get(message)
        elif operation == "set":
            self._handle_set(message)
        elif operation == "new":
            self._handle_construct(message)

    def _message_path(self, message: Dict[str, Any]) -> List[str]:
        path = message.get("p")
        if not isinstance(path, list):
            return []
        return [part for part in path if isinstance(part, str)]

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
            if isinstance(arg, dict) and arg.get(ARG_ENVELOPE_TAG) == "callback":
                callback_id = str(arg.get("id", ""))

                def _callback(*callback_args: Any, _callback_id: str = callback_id) -> None:
                    self._write_message(
                        {
                            "t": "cb",
                            "id": _callback_id,
                            "a": list(callback_args),
                        }
                    )

                processed.append(_callback)
            else:
                processed.append(arg)
        return processed

    def _send_response(self, request_id: str, result: Any) -> None:
        self._write_message(
            {
                "t": "r",
                "id": request_id,
                "v": result,
            }
        )

    def _send_error(self, request_id: str, error: Exception) -> None:
        self._write_message(
            {
                "t": "r",
                "id": request_id,
                "e": {"n": error.__class__.__name__, "m": str(error)},
            }
        )

    def _handle_request(self, message: Dict[str, Any]) -> None:
        request_id = message.get("id", "")
        args = message.get("a")
        if not isinstance(args, list):
            args = []
        try:
            path = self._message_path(message)
            target = self._resolve_path(path)
            if not callable(target):
                raise TypeError(f"Method {'.'.join(path)} is not callable")
            result = target(*self._wrap_callbacks(args, request_id))
            self._send_response(request_id, result)
        except Exception as error:
            self._send_error(request_id, error)

    def _handle_get(self, message: Dict[str, Any]) -> None:
        request_id = message.get("id", "")
        path = self._message_path(message)
        if not path:
            self._send_error(request_id, ValueError("Missing path"))
            return
        try:
            result = self._resolve_path(path)
            self._send_response(request_id, result)
        except Exception as error:
            self._send_error(request_id, error)

    def _handle_set(self, message: Dict[str, Any]) -> None:
        request_id = message.get("id", "")
        path = self._message_path(message)
        if not path:
            self._send_error(request_id, ValueError("Missing path"))
            return
        try:
            parent = self._resolve_path(path[:-1])
            if not isinstance(parent, dict):
                raise TypeError("Set target is not an object")
            parent[path[-1]] = message.get("v")
            self._send_response(request_id, True)
        except Exception as error:
            self._send_error(request_id, error)

    def _handle_construct(self, message: Dict[str, Any]) -> None:
        request_id = message.get("id", "")
        args = message.get("a")
        if not isinstance(args, list):
            args = []
        try:
            path = self._message_path(message)
            constructor = self._resolve_path(path)
            if not callable(constructor):
                raise TypeError(f"Constructor {'.'.join(path)} is not callable")
            result = constructor(*self._wrap_callbacks(args, request_id))
            self._send_response(request_id, result)
        except Exception as error:
            self._send_error(request_id, error)
