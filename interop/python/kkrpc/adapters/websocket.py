import base64
import os
import queue
import socket
import ssl
import struct
import threading
from typing import Optional
from urllib.parse import urlparse

from .base import Transport


class WebSocketTransport(Transport):
	def __init__(self, url: str) -> None:
		parsed = urlparse(url)
		if parsed.scheme not in {"ws", "wss"}:
			raise ValueError("websocket url must be ws:// or wss://")
		host = parsed.hostname or ""
		port = parsed.port or (443 if parsed.scheme == "wss" else 80)
		path = parsed.path or "/"
		if parsed.query:
			path = f"{path}?{parsed.query}"

		self._socket = socket.create_connection((host, port))
		if parsed.scheme == "wss":
			context = ssl.create_default_context()
			self._socket = context.wrap_socket(self._socket, server_hostname=host)

		key = base64.b64encode(os.urandom(16)).decode("ascii")
		handshake = (
			f"GET {path} HTTP/1.1\r\n"
			f"Host: {host}:{port}\r\n"
			"Upgrade: websocket\r\n"
			"Connection: Upgrade\r\n"
			f"Sec-WebSocket-Key: {key}\r\n"
			"Sec-WebSocket-Version: 13\r\n\r\n"
		)
		self._socket.sendall(handshake.encode("utf-8"))
		response = self._read_http_response()
		if "101" not in response.split("\r\n", 1)[0]:
			raise ConnectionError("websocket handshake failed")

		self._queue: "queue.Queue[Optional[str]]" = queue.Queue()
		self._closed = threading.Event()
		self._thread = threading.Thread(target=self._read_loop, daemon=True)
		self._thread.start()

	def _read_http_response(self) -> str:
		buffer = b""
		while b"\r\n\r\n" not in buffer:
			chunk = self._socket.recv(4096)
			if not chunk:
				break
			buffer += chunk
		return buffer.decode("utf-8", errors="ignore")

	def _read_exact(self, length: int) -> bytes:
		buffer = b""
		while len(buffer) < length:
			chunk = self._socket.recv(length - len(buffer))
			if not chunk:
				raise ConnectionError("websocket closed")
			buffer += chunk
		return buffer

	def _read_frame(self) -> Optional[str]:
		header = self._read_exact(2)
		byte1, byte2 = header
		opcode = byte1 & 0x0F
		if opcode == 0x8:
			return None
		masked = (byte2 & 0x80) != 0
		length = byte2 & 0x7F
		if length == 126:
			length = struct.unpack("!H", self._read_exact(2))[0]
		elif length == 127:
			length = struct.unpack("!Q", self._read_exact(8))[0]
		mask_key = b""
		if masked:
			mask_key = self._read_exact(4)
		payload = self._read_exact(length)
		if masked:
			payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
		return payload.decode("utf-8")

	def _send_frame(self, message: str) -> None:
		payload = message.encode("utf-8")
		length = len(payload)
		byte1 = 0x80 | 0x1
		mask_bit = 0x80
		if length <= 125:
			header = struct.pack("!BB", byte1, mask_bit | length)
		elif length <= 0xFFFF:
			header = struct.pack("!BBH", byte1, mask_bit | 126, length)
		else:
			header = struct.pack("!BBQ", byte1, mask_bit | 127, length)
		mask_key = os.urandom(4)
		masked_payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
		self._socket.sendall(header + mask_key + masked_payload)

	def _read_loop(self) -> None:
		try:
			while not self._closed.is_set():
				message = self._read_frame()
				if message is None:
					break
				self._queue.put(message)
		except OSError:
			pass
		finally:
			self._queue.put(None)

	def read(self) -> Optional[str]:
		return self._queue.get()

	def write(self, message: str) -> None:
		self._send_frame(message)

	def close(self) -> None:
		self._closed.set()
		try:
			self._socket.close()
		except OSError:
			pass
