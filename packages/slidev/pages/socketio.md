---
transition: slide-up
layout: two-cols-header
layoutClass: gap-4
---

# Socket.IO

> Real-Time Bidirectional RPC
> 
> Automatic reconnection, fallback support, type safety, bidirectional communication

::left::

### Traditional Socket.IO

```ts {*}{maxHeight:'350px'}
// Client - Event-based messaging
const socket = io("http://localhost:3000")

// Emit with callback acknowledgement
socket.emit("add", { a: 5, b: 3 }, 
	(result) => {
		console.log(result) // 8
		// No type safety!
	})

// Handle multiple events
socket.on("math:multiply", (data, callback) => {
	const result = data.a * data.b
	callback(result)
})

// Manual error handling
socket.timeout(5000).emit("getUser", 
	{ id: 123 }, 
	(err, response) => {
		if (err) {
			console.error("Timeout!")
			return
		}
		console.log(response)
	})
```

::right::

### With kkRPC

```ts {*}{maxHeight:'350px'}
// Client - Direct function calls
import { SocketIOClientIO, RPCChannel } 
	from "kkrpc/socketio"

const clientIO = new SocketIOClientIO({
	url: "http://localhost:3000"
})

const rpc = new RPCChannel<{}, MathAPI>(clientIO)
const math = rpc.getAPI()

// Type-safe function calls!
const sum = await math.add(5, 3)
// TypeScript knows sum is a number ✨

// Works with nested APIs too
const product = await math.grade2.multiply(4, 6)

// Namespaces supported
const io = new SocketIOClientIO({
	url: "http://localhost:3000",
	namespace: "rpc"
})
```

<!--
Traditional Socket.IO requires manual event handling with string-based event names and callbacks. You need to manage acknowledgements, timeouts, and error handling manually. No type safety means errors at runtime.

With kkRPC over Socket.IO:
- Event names become function calls with full TypeScript autocomplete
- Automatic acknowledgements handled by RPC layer
- Bidirectional - both client and server can expose APIs
- Supports Socket.IO features like namespaces, rooms, auto-reconnection
- Error preservation across the wire

Perfect for real-time applications that need reliable bidirectional communication with type safety.
-->
