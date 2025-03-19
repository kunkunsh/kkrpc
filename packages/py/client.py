import asyncio
import subprocess
from io_interface import IoInterface
from channel import RPCChannel

class SubprocessInterface(IoInterface):
    def __init__(self, process):
        self.process = process
    
    @property
    def name(self) -> str:
        return "subprocess"
    
    async def read(self):
        if self.process.stdout.at_eof():
            return None
        return await self.process.stdout.readline()
    
    async def write(self, data: str):
        self.process.stdin.write(data.encode("utf-8"))
        await self.process.stdin.drain()

async def main():
    # Start the server as a subprocess
    process = await asyncio.create_subprocess_exec(
        "python", "server.py",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE
    )
    
    # Create the IO interface and RPC channel
    io = SubprocessInterface(process)
    rpc = RPCChannel(io)
    
    # Get the remote API
    api = rpc.get_api()
    
    # Call methods on the remote API
    result = await api.math.add(5, 3)
    print(f"5 + 3 = {result}")
    
    result = await api.math.subtract(10, 4)
    print(f"10 - 4 = {result}")
    
    result = await api.greet("Python")
    print(result)
    
    # Test with a callback
    def my_callback(message):
        print(f"Callback received: {message}")
    
    await api.callback_demo(my_callback)
    
    # Gracefully terminate the server
    process.terminate()
    await process.wait()

if __name__ == "__main__":
    asyncio.run(main())
