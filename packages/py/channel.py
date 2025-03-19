# channel.py
import asyncio
import uuid
from typing import Dict, Any, Callable, List, Optional, Union, TypeVar, Generic
from io_interface import IoInterface
from serialization import Message, serialize_message, deserialize_message

T = TypeVar("T", bound=Dict[str, Any])
R = TypeVar("R", bound=Dict[str, Any])


class PendingRequest:
    def __init__(self):
        self.future = asyncio.Future()

    def resolve(self, result: Any):
        self.future.set_result(result)

    def reject(self, error: Any):
        self.future.set_exception(Exception(error))


class RPCChannel(Generic[T, R]):
    def __init__(self, io: IoInterface, expose: Optional[T] = None):
        self.io = io
        self.api_implementation = expose or {}
        self.pending_requests: Dict[str, PendingRequest] = {}
        self.callbacks: Dict[str, Callable] = {}
        self.callback_cache: Dict[Callable, str] = {}
        self.message_str: str = ""

        # Start listening for messages
        asyncio.create_task(self.listen())

    def expose(self, api: T):
        """Expose a local API implementation that can be called remotely"""
        self.api_implementation = api

    async def listen(self):
        """Listen for incoming messages and handle them"""
        while True:
            buffer = await self.io.read()
            if not buffer:
                continue

            buffer_str = buffer.decode("utf-8") if isinstance(buffer, bytes) else str(buffer)
            if not buffer_str.strip():
                continue

            self.message_str += buffer_str
            last_char = self.message_str[-1] if self.message_str else ""
            msgs_split = self.message_str.split("\n")
            msgs = msgs_split if last_char == "\n" else msgs_split[:-1]
            self.message_str = (
                "" if last_char == "\n" else (msgs_split[-1] if msgs_split else "")
            )

            for msg_str in (m.strip() for m in msgs if m.strip()):
                if msg_str.startswith("{"):
                    await self.handle_message_str(msg_str)
                else:
                    print(f"(kkrpc stdout passthrough): {msg_str}")

    async def handle_message_str(self, message_str: str):
        """Handle a single message string"""
        try:
            parsed_message = deserialize_message(message_str)

            if parsed_message.type == "response":
                self.handle_response(parsed_message)
            elif parsed_message.type == "request":
                await self.handle_request(parsed_message)
            elif parsed_message.type == "callback":
                self.handle_callback(parsed_message)
            else:
                print(f"Received unknown message type: {parsed_message.type}")
        except Exception as e:
            print(f"Error handling message: {e}")
            print(f"(kkrpc stdout passthrough): {message_str}")

    async def call_method(self, method: str, args: List[Any]) -> Any:
        """Call a method on the remote API"""
        request_id = str(uuid.uuid4())
        pending = PendingRequest()
        self.pending_requests[request_id] = pending

        callback_ids = []
        processed_args = []

        for arg in args:
            if callable(arg):
                callback_id = self.callback_cache.get(arg)
                if not callback_id:
                    callback_id = str(uuid.uuid4())
                    self.callbacks[callback_id] = arg
                    self.callback_cache[arg] = callback_id

                callback_ids.append(callback_id)
                processed_args.append(f"__callback__{callback_id}")
            else:
                processed_args.append(arg)

        message = Message(
            id=request_id,
            method=method,
            args=processed_args,
            type="request",
            callback_ids=callback_ids if callback_ids else None,
        )

        await self.io.write(serialize_message(message))
        return await pending.future

    def handle_response(self, response: Message):
        """Handle a response from a remote method call"""
        request_id = response.id
        if request_id in self.pending_requests:
            if (
                isinstance(response.args, dict)
                and "error" in response.args
                and response.args["error"]
            ):
                self.pending_requests[request_id].reject(response.args["error"])
            else:
                result = (
                    response.args.get("result")
                    if isinstance(response.args, dict)
                    else response.args
                )
                self.pending_requests[request_id].resolve(result)

            del self.pending_requests[request_id]

    async def handle_request(self, request: Message):
        """Handle an incoming method call request"""
        request_id = request.id
        method_path = request.method.split(".")

        # Find the target method in the API implementation
        target = self.api_implementation

        for i in range(len(method_path) - 1):
            component = method_path[i]
            if component not in target:
                await self.send_error(
                    request_id, f"Method path {request.method} not found at {component}"
                )
                return
            target = target[component]

        final_method = method_path[-1]
        if final_method not in target:
            await self.send_error(request_id, f"Method {request.method} not found")
            return

        target_method = target[final_method]
        if not callable(target_method):
            await self.send_error(
                request_id, f"Method {request.method} is not a function"
            )
            return

        # Process arguments, converting callback placeholders back to functions
        processed_args = []
        for arg in request.args:
            if isinstance(arg, str) and arg.startswith("__callback__"):
                callback_id = arg[12:]  # Remove "__callback__" prefix

                def callback_func(*callback_args):
                    asyncio.create_task(
                        self.invoke_callback(callback_id, list(callback_args))
                    )

                processed_args.append(callback_func)
            else:
                processed_args.append(arg)

        # Call the target method
        try:
            result = target_method(*processed_args)
            # If the result is awaitable, await it
            if asyncio.iscoroutine(result):
                result = await result
            await self.send_response(request_id, result)
        except Exception as e:
            await self.send_error(request_id, str(e))

    def handle_callback(self, message: Message):
        """Handle a callback invocation from the remote endpoint"""
        callback_id = message.method
        if callback_id in self.callbacks:
            callback = self.callbacks[callback_id]
            callback(*message.args)
        else:
            print(f"Callback with id {callback_id} not found")

    async def send_response(self, request_id: str, result: Any):
        """Send a successful response back to the remote endpoint"""
        response = Message(
            id=request_id, method="", args={"result": result}, type="response"
        )
        await self.io.write(serialize_message(response))

    async def send_error(self, request_id: str, error: str):
        """Send an error response back to the remote endpoint"""
        response = Message(
            id=request_id, method="", args={"error": error}, type="response"
        )
        await self.io.write(serialize_message(response))

    async def invoke_callback(self, callback_id: str, args: List[Any]):
        """Invoke a callback on the remote endpoint"""
        message = Message(
            id=str(uuid.uuid4()), method=callback_id, args=args, type="callback"
        )
        await self.io.write(serialize_message(message))

    def get_api(self):
        """Get a proxy object for the remote API"""
        return RPCProxy(self)


class RPCProxy:
    def __init__(self, channel: RPCChannel, path: Optional[List[str]] = None):
        self._channel = channel
        self._path = path or []

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(f"No such attribute: {name}")

        # Return a new proxy for nested paths
        return RPCProxy(self._channel, self._path + [name])

    async def __call__(self, *args):
        # Join the path components with dots (e.g., "math.add")
        method = ".".join(self._path)
        return await self._channel.call_method(method, list(args))


# Implementation of IoInterface for stdio communication
import sys
import asyncio


class StdioInterface(IoInterface):
    @property
    def name(self) -> str:
        return "stdio"

    async def read(self) -> Optional[bytes]:
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, sys.stdin.buffer.readline)
        return data if data else None

    async def write(self, data: str) -> None:
        sys.stdout.write(data)
        sys.stdout.flush()
