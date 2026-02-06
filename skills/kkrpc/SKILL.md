---
name: kkrpc
description: Build bidirectional RPC systems in TypeScript with kkrpc. Create RPC channels, expose APIs, use multiple transports (stdio, WebSocket, HTTP), handle callbacks, property access, and errors across Node.js, Deno, Bun, and browsers.
version: 1.0.0
license: MIT
metadata:
  author: kkrpc
  domain: typescript-rpc
  tags:
    - rpc
    - typescript
    - bidirectional
    - ipc
    - websocket
    - stdio
    - cross-runtime
compatibility: Works in Node.js, Deno, Bun, and browsers with appropriate entry points
---

# kkrpc - TypeScript RPC Library

Build bidirectional RPC systems in TypeScript with full type safety and multiple transport options.

## Installation

```bash
# npm
npm install kkrpc

# pnpm
pnpm add kkrpc

# Deno
import { RPCChannel } from "jsr:@kunkun/kkrpc"
```

---

## Quick Start

### Basic RPC Setup

**Server (expose API):**

```typescript
import { NodeIo, RPCChannel } from "kkrpc"

const api = {
	greet: (name: string) => `Hello, ${name}!`,
	add: (a: number, b: number) => a + b,
	counter: 42
}

const rpc = new RPCChannel(new NodeIo(process.stdin, process.stdout), { expose: api })
```

**Client (consume API):**

```typescript
import { spawn } from "child_process"
import { NodeIo, RPCChannel } from "kkrpc"

const worker = spawn("bun", ["server.ts"])
const rpc = new RPCChannel(new NodeIo(worker.stdout, worker.stdin))

const api = rpc.getAPI<typeof api>()

console.log(await api.greet("World")) // "Hello, World!"
console.log(await api.add(5, 3)) // 8
console.log(await api.counter) // 42
```

---

## Core Concepts

### RPCChannel

The main class that manages bidirectional communication:

```typescript
class RPCChannel<LocalAPI extends Record<string, any>, RemoteAPI extends Record<string, any>> {
	constructor(
		io: IoInterface,
		options?: {
			expose?: LocalAPI
			serialization?: { version: "json" | "superjson" }
			validators?: RPCValidators<LocalAPI>
		}
	)

	getAPI(): RemoteAPI // Get proxy to remote API
	expose(api: LocalAPI): void // Expose local API
}
```

### IoInterface (Transports)

Transport adapters for different environments:

| Transport        | Class                                               | Environment        |
| ---------------- | --------------------------------------------------- | ------------------ |
| stdio            | `NodeIo`, `DenoIo`, `BunIo`                         | Process-to-process |
| WebSocket        | `WebSocketClientIO`, `WebSocketServerIO`            | Network            |
| HTTP             | `HTTPClientIO`, `HTTPServerIO`                      | Web APIs           |
| Worker           | `WorkerParentIO`, `WorkerChildIO`                   | Web Workers        |
| postMessage      | `IframeParentIO`, `IframeChildIO`                   | iframes            |
| Chrome Extension | `ChromePortIO`                                      | Chrome extensions  |
| Electron         | `ElectronIpcMainIO`, `ElectronIpcRendererIO`        | Electron           |
| Message Queues   | `RabbitMQIO`, `KafkaIO`, `RedisStreamsIO`, `NatsIO` | Distributed        |

---

## API Definition Patterns

### Pattern 1: Inline API (Simple)

```typescript
const api = {
	greet: (name: string) => `Hello, ${name}!`,
	add: (a: number, b: number) => a + b
}

type API = typeof api

const rpc = new RPCChannel<API, API>(io, { expose: api })
const remote = rpc.getAPI()
```

### Pattern 2: Interface-First (Recommended)

```typescript
interface MathAPI {
	add(a: number, b: number): Promise<number>
	multiply(a: number, b: number): Promise<number>
}

interface MyAPI {
	math: MathAPI
	greet(name: string): Promise<string>
}

const api: MyAPI = {
	math: {
		add: async (a, b) => a + b,
		multiply: async (a, b) => a * b
	},
	greet: async (name) => `Hello, ${name}!`
}

const rpc = new RPCChannel<MyAPI, MyAPI>(io, { expose: api })
```

### Pattern 3: Nested APIs

```typescript
interface API {
	math: {
		basic: {
			add(a: number, b: number): Promise<number>
			subtract(a: number, b: number): Promise<number>
		}
		advanced: {
			pow(base: number, exp: number): Promise<number>
			sqrt(n: number): Promise<number>
		}
	}
}

// Usage
const result = await api.math.advanced.pow(2, 10) // 1024
```

---

## Transport Examples

### Stdio (Process Communication)

```typescript
import { spawn } from "child_process"
import { NodeIo, RPCChannel } from "kkrpc"

// Spawn child process
const child = spawn("bun", ["worker.ts"])

// Create channel
const io = new NodeIo(child.stdout, child.stdin)
const rpc = new RPCChannel<LocalAPI, RemoteAPI>(io, { expose: localApi })

// Get remote API
const api = rpc.getAPI()
```

### WebSocket

```typescript
import { RPCChannel, WebSocketClientIO, WebSocketServerIO } from "kkrpc"

// Server
wss.on("connection", (ws) => {
	const io = new WebSocketServerIO(ws)
	const rpc = new RPCChannel<API, API>(io, { expose: api })
})

// Client
const ws = new WebSocket("ws://localhost:3000")
const io = new WebSocketClientIO({ ws })
const rpc = new RPCChannel<{}, API>(io)
const api = rpc.getAPI()
```

### Web Worker

```typescript
import { WorkerParentIO, WorkerChildIO, RPCChannel } from "kkrpc/browser"

// Main thread
const worker = new Worker("./worker.ts", { type: "module" })
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel<LocalAPI, RemoteAPI>(io, { expose: localApi })

// Worker thread
const io = new WorkerChildIO()
const rpc = new RPCChannel<RemoteAPI, LocalAPI>(io, { expose: api })
```

### HTTP

```typescript
import { HTTPClientIO, HTTPServerIO, RPCChannel } from "kkrpc"

// Server
const serverIO = new HTTPServerIO()
const serverRPC = new RPCChannel<API, API>(serverIO, { expose: api })

Bun.serve({
	async fetch(req) {
		if (new URL(req.url).pathname === "/rpc") {
			const response = await serverIO.handleRequest(await req.text())
			return new Response(response, {
				headers: { "Content-Type": "application/json" }
			})
		}
		return new Response("Not found", { status: 404 })
	}
})

// Client
const clientIO = new HTTPClientIO({ url: "http://localhost:3000/rpc" })
const clientRPC = new RPCChannel<{}, API>(clientIO)
```

---

## Advanced Features

### Callback Functions

Send functions as arguments that can be invoked remotely:

```typescript
interface API {
	processData(data: string, onProgress: (percent: number) => void): Promise<string>
}

// Server
const api: API = {
	processData: async (data, onProgress) => {
		for (let i = 0; i <= 100; i += 10) {
			onProgress(i)
			await sleep(100)
		}
		return `Processed: ${data}`
	}
}

// Client
const result = await api.processData("my-data", (progress) => {
	console.log(`Progress: ${progress}%`)
})
```

### Property Access

Access and mutate remote properties:

```typescript
interface API {
	counter: number
	settings: {
		theme: string
		notifications: { enabled: boolean }
	}
}

// Get values
const count = await api.counter
const theme = await api.settings.theme

// Set values
api.counter = 100
api.settings.theme = "dark"
```

### Enhanced Error Handling

Errors preserve name, message, stack, and custom properties:

```typescript
class ValidationError extends Error {
	constructor(
		message: string,
		public field: string,
		public code: number
	) {
		super(message)
		this.name = "ValidationError"
	}
}

// Thrown on server
type API = {
	validateUser(data: unknown): Promise<void>
}

// Caught on client
try {
	await api.validateUser({})
} catch (error) {
	console.log(error.name) // "ValidationError"
	console.log(error.message) // "Name is required"
	console.log(error.field) // "name"
	console.log(error.code) // 400
}
```

### Validation (Optional)

Use Standard Schema (Zod, Valibot, ArkType) for runtime validation:

```typescript
import { RPCChannel, type RPCValidators } from "kkrpc"
import { z } from "zod"

type MathAPI = {
	add(a: number, b: number): Promise<number>
}

const api: MathAPI = {
	add: async (a, b) => a + b
}

const validators: RPCValidators<MathAPI> = {
	add: {
		input: z.tuple([z.number(), z.number()]),
		output: z.number()
	}
}

const rpc = new RPCChannel(io, { expose: api, validators })
```

### Transferable Objects (Browser)

Zero-copy transfer of large binary data:

```typescript
import { RPCChannel, transfer, WorkerParentIO } from "kkrpc/browser"

interface API {
	processBuffer(buffer: ArrayBuffer): Promise<number>
}

const worker = new Worker("worker.js")
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel<{}, API>(io)
const api = rpc.getAPI()

// Create large buffer
const buffer = new ArrayBuffer(10 * 1024 * 1024)

// Transfer (zero-copy) to worker
const result = await api.processBuffer(transfer(buffer, [buffer]))
// Note: buffer is now detached (length 0)
```

---

## Serialization Options

### JSON (Default for Interop)

```typescript
const rpc = new RPCChannel(io, {
	expose: api,
	serialization: { version: "json" }
})
```

- Standard JSON
- Works with all interop languages
- No Date, Map, Set, BigInt support

### SuperJSON (Default, TypeScript-only)

```typescript
const rpc = new RPCChannel(io, {
	expose: api,
	serialization: { version: "superjson" }
})
```

- Supports Date, Map, Set, BigInt, Uint8Array
- TypeScript-to-TypeScript only
- Auto-detected by receiver

---

## Common Patterns

### Bidirectional Communication

Both sides expose APIs:

```typescript
// Side A
interface API_A {
	compute(data: number[]): Promise<number>
}

interface API_B {
	notify(message: string): Promise<void>
}

const apiA: API_A = {
	compute: async (data) => data.reduce((a, b) => a + b, 0)
}

const rpc = new RPCChannel<API_A, API_B>(io, { expose: apiA })
const apiB = rpc.getAPI()

// Call B from A
await apiB.notify("Computation complete")
```

### Dynamic API Exposure

Change exposed API at runtime:

```typescript
const rpc = new RPCChannel(io)

// Later...
rpc.expose(newApi)
```

### Cleanup

Destroy connections when done:

```typescript
// For transports that support it
io.destroy()
```

---

## Environment-Specific Entry Points

| Environment      | Import Path                         |
| ---------------- | ----------------------------------- |
| Node.js          | `kkrpc`                             |
| Deno             | `kkrpc/deno` or `jsr:@kunkun/kkrpc` |
| Bun              | `kkrpc`                             |
| Browser          | `kkrpc/browser`                     |
| Chrome Extension | `kkrpc/chrome-extension`            |

```typescript
// Browser (excludes stdio)
import { RPCChannel, WorkerParentIO } from "kkrpc/browser"

// Deno
import { RPCChannel, DenoIo } from "kkrpc/deno"

// Chrome Extension
import { RPCChannel, ChromePortIO } from "kkrpc/chrome-extension"
```

---

## Error Reference

| Error                | Cause                          | Solution                             |
| -------------------- | ------------------------------ | ------------------------------------ |
| `RPCValidationError` | Input/output validation failed | Check validation schema              |
| `TimeoutError`       | Request timed out              | Increase timeout or check connection |
| `TransportClosed`    | Connection closed unexpectedly | Check transport health               |

---

## Testing

### Test with Reference Implementation

```typescript
// interop/node/server.ts provides a test server
const api = {
	math: { add: (a: number, b: number) => a + b },
	echo: <T>(v: T) => v,
	counter: 42
}
```

### Unit Test Pattern

```typescript
import { expect, test } from "bun:test"
import { NodeIo, RPCChannel } from "kkrpc"

test("basic RPC call", async () => {
	const api = { add: (a: number, b: number) => a + b }

	// Create connected pair
	const { port1, port2 } = new MessageChannel()

	const serverIO = new NodeIo(port1)
	const clientIO = new NodeIo(port2)

	new RPCChannel<typeof api, {}>(serverIO, { expose: api })
	const client = new RPCChannel<{}, typeof api>(clientIO)

	const result = await client.getAPI().add(2, 3)
	expect(result).toBe(5)
})
```

---

## Best Practices

1. **Use Interface-First**: Define interfaces before implementations for type safety
2. **Handle Errors**: Always wrap RPC calls in try-catch
3. **Clean Up**: Destroy transports when components unmount
4. **Validate Inputs**: Use validators for public APIs
5. **Choose Serialization**: Use JSON for interop, superjson for TS-only
6. **Transfer Large Data**: Use `transfer()` for ArrayBuffers in browsers
7. **Namespace APIs**: Use nested objects to organize methods

---

## References

- Package: `packages/kkrpc/`
- Core source: `packages/kkrpc/src/`
- Serialization: `packages/kkrpc/src/serialization.ts`
- Adapters: `packages/kkrpc/src/adapters/`
- Interop guide: `skills/interop/SKILL.md`
