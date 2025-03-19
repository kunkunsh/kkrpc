import asyncio
from io_interface import IoInterface
from channel import RPCChannel, StdioInterface

# Define the API
api = {
    "math": {
        "add": lambda a, b: a + b,
        "subtract": lambda a, b: a - b,
        "multiply": lambda a, b: a * b,
        "divide": lambda a, b: a / b if b != 0 else "Cannot divide by zero"
    },
    "echo": lambda message: message,
    "greet": lambda name: f"Hello, {name}!",
    "callback_demo": lambda callback: callback("This is a callback from Python!")
}

async def main():
    # Create the IO interface and RPC channel
    io = StdioInterface()
    rpc = RPCChannel(io, expose=api)
    
    # Keep the server running
    while True:
        await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(main())
