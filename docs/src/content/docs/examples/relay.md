---
title: Relay
description: Create transparent bridges between different transport layers
---

The `createRelay` function creates a transparent bidirectional relay between two IoInterfaces. This enables connecting two different transport layers without the intermediary process knowing the API details.

## Overview

```
A <-> Relay <-> B
```

A relay forwards messages bidirectionally without parsing them. The intermediary process acts as a transparent byte pipe.

## Why Use Relay?

### Problem: Direct Delegation

Without relay, Main must know all external process APIs:

```ts title="main.ts (without relay)"
const mainAPI = {
	// Main must delegate every method manually
	calculate: async (n: number) => workerAPI.calculate(n),
	processData: async (data: string) => workerAPI.processData(data)
	// ... every method must be listed
}
```

**Problems:**

- Main must know all worker APIs
- Proxy delegation is complex and ugly
- Tight coupling between Main and Worker

### Solution: Transparent Relay

With relay, Main just forwards bytes:

```ts title="main.ts (with relay)"
const relay = createRelay(
	new ElectronIpcMainIO(ipcMain, webContents, "worker-relay"),
	new NodeIo(worker.stdout, worker.stdin)
)
// Main knows NOTHING about worker API!
```

**Benefits:**

- Main is a transparent pipe
- No API knowledge in Main
- Clean separation of concerns
- Easy to add/remove workers

## Electron Scenarios

### Scenario 1: Renderer → External Node Process

Connect Electron's Renderer process to an external Node.js/Bun/Deno process.

```
Renderer (IPC) → Main (relay) → External Node Process (stdio)
```

#### Architecture

```
┌─────────────────┐     IPC      ┌─────────────────┐     stdio      ┌─────────────────┐
│   Renderer      │─────────────►│      Main       │───────────────►│  External Node  │
│  (Chromium)     │              │   (transparent  │                │   Process       │
│                 │◄─────────────│    relay)       │◄───────────────│                 │
│ kkrpc/electron- │   "worker-    │                 │                │     NodeIo      │
│    ipc          │   relay"      │  ElectronIpc    │                │                 │
│                 │   channel     │  MainIO         │                │  (stdin/stdout) │
│ ElectronIpc     │              │                 │                │                 │
│ RendererIO      │              │  createRelay()  │                │  kkrpc (main)   │
│  ("worker-      │              │                 │                │                 │
│   relay")       │              │                 │                │                 │
└─────────────────┘              └─────────────────┘                └─────────────────┘
```

#### Implementation

**Main Process** (creates the relay):

```ts title="main.ts"
import { spawn } from "child_process"
import { createRelay, NodeIo } from "kkrpc"
import { ElectronIpcMainIO } from "kkrpc/electron-ipc"

// Spawn external Node.js process
const workerPath = path.join(__dirname, "./calculation-worker.js")
const workerProcess = spawn("node", [workerPath])

// Create transparent relay
// IPC channel "calc-relay" <-> stdio
const relay = createRelay(
	new ElectronIpcMainIO(ipcMain, webContents, "calc-relay"),
	new NodeIo(workerProcess.stdout, workerProcess.stdin)
)

// Cleanup
app.on("window-all-closed", () => {
	relay.destroy()
	workerProcess.kill()
})
```

**Renderer Process** (uses the relay):

```ts title="renderer.ts"
import { ElectronIpcRendererIO, RPCChannel } from "kkrpc/electron-ipc"
import type { CalculationAPI } from "./api"

// IMPORTANT: Use the SAME channel name as in Main
const io = new ElectronIpcRendererIO("calc-relay")
const rpc = new RPCChannel<{}, CalculationAPI>(io)
const calcAPI = rpc.getAPI()

// Calls go directly to external worker through Main's relay
const result = await calcAPI.heavyCalculation(1000000)
```

**External Worker Process**:

```ts title="calculation-worker.ts"
import { NodeIo, RPCChannel } from "kkrpc"
import type { CalculationAPI } from "./api"

const calculationAPI: CalculationAPI = {
	heavyCalculation: async (n: number) => {
		// CPU-intensive work
		let result = 0
		for (let i = 0; i < n; i++) {
			result += Math.sqrt(i)
		}
		return result
	}
}

const io = new NodeIo(process.stdin, process.stdout)
const rpc = new RPCChannel<CalculationAPI, {}>(io, { expose: calculationAPI })
```

### Scenario 2: Renderer → Python Process

Connect Renderer to a Python process through Main.

```
Renderer (IPC) → Main (relay) → Python Process (stdio)
```

**Main Process**:

```ts title="main.ts"
import { spawn } from "child_process"
import { createRelay, NodeIo } from "kkrpc"
import { ElectronIpcMainIO } from "kkrpc/electron-ipc"

// Spawn Python process
const pythonProcess = spawn("python", ["./ml-model.py"])

// Create relay
const mlRelay = createRelay(
	new ElectronIpcMainIO(ipcMain, webContents, "ml-relay"),
	new NodeIo(pythonProcess.stdout, pythonProcess.stdin)
)

// Python must output JSON-RPC compatible messages
```

**Renderer**:

```ts title="renderer.ts"
import { ElectronIpcRendererIO, RPCChannel } from "kkrpc/electron-ipc"
import type { MLAPI } from "./api"

const io = new ElectronIpcRendererIO("ml-relay")
const rpc = new RPCChannel<{}, MLAPI>(io)
const mlAPI = rpc.getAPI()

const prediction = await mlAPI.predict([1.2, 3.4, 5.6])
```

### Scenario 3: Multiple Workers

Create multiple relays for different workers:

```ts title="main.ts"
// Worker 1: Calculation service
const calcWorker = spawn("node", ["./calc-worker.js"])
const calcRelay = createRelay(
	new ElectronIpcMainIO(ipcMain, win.webContents, "calc-relay"),
	new NodeIo(calcWorker.stdout, calcWorker.stdin)
)

// Worker 2: ML service
const mlWorker = spawn("python", ["./ml-worker.py"])
const mlRelay = createRelay(
	new ElectronIpcMainIO(ipcMain, win.webContents, "ml-relay"),
	new NodeIo(mlWorker.stdout, mlWorker.stdin)
)

// Worker 3: File processing
const fileWorker = spawn("bun", ["./file-worker.ts"])
const fileRelay = createRelay(
	new ElectronIpcMainIO(ipcMain, win.webContents, "file-relay"),
	new NodeIo(fileWorker.stdout, fileWorker.stdin)
)
```

```ts title="renderer.ts"
// Each worker has its own channel
const calcAPI = new RPCChannel<{}, CalcAPI>(new ElectronIpcRendererIO("calc-relay")).getAPI()

const mlAPI = new RPCChannel<{}, MLAPI>(new ElectronIpcRendererIO("ml-relay")).getAPI()

const fileAPI = new RPCChannel<{}, FileAPI>(new ElectronIpcRendererIO("file-relay")).getAPI()
```

### Scenario 4: WebSocket → Stdio Bridge

Create a bridge between WebSocket clients and local processes:

```
Browser (WebSocket) → Server (relay) → Local Process (stdio)
```

**Server**:

```ts title="server.ts"
import { spawn } from "child_process"
import { createRelay, NodeIo, WebSocketServerIO } from "kkrpc"

const wss = new WebSocketServer({ port: 8080 })

wss.on("connection", (ws) => {
	// Spawn new process for each connection
	const process = spawn("node", ["./worker.js"])

	// Bridge WebSocket to stdio
	const relay = createRelay(new WebSocketServerIO(ws), new NodeIo(process.stdout, process.stdin))

	ws.on("close", () => {
		relay.destroy()
		process.kill()
	})
})
```

## Supported Adapter Combinations

| From                | To       | Use Case                       | Environment     |
| ------------------- | -------- | ------------------------------ | --------------- |
| `ElectronIpcMainIO` | `NodeIo` | Renderer to Node/Bun/Deno      | Electron + Node |
| `ElectronIpcMainIO` | `DenoIo` | Renderer to Deno               | Electron + Deno |
| `ElectronIpcMainIO` | `BunIo`  | Renderer to Bun                | Electron + Bun  |
| `WebSocketServerIO` | `NodeIo` | Browser to local process       | Server + Node   |
| `WorkerParentIO`    | `NodeIo` | Web Worker to external process | Browser + Node  |
| `HTTPClientIO`      | `NodeIo` | HTTP client to local process   | Any + Node      |

## API Reference

### `createRelay(a, b)`

Creates a bidirectional relay between two IoInterfaces.

```ts
import { createRelay } from "kkrpc"

const relay = createRelay(adapterA, adapterB)

// Cleanup when done
relay.destroy()
```

#### Parameters

- `a: IoInterface` - First adapter
- `b: IoInterface` - Second adapter

Both adapters must support the `onMessage` hook for event-driven forwarding.

#### Returns

`Relay` object with:

- `destroy(): void` - Stops the relay and restores original `onMessage` handlers

## How It Works

The relay works by intercepting messages through the `onMessage` hook:

```ts
// Pseudocode of createRelay
function createRelay(a, b) {
	const originalAOnMessage = a.onMessage
	const originalBOnMessage = b.onMessage

	// When A receives a message, forward to B
	a.onMessage = async (message) => {
		if (originalAOnMessage) await originalAOnMessage(message)
		await b.write(message)
	}

	// When B receives a message, forward to A
	b.onMessage = async (message) => {
		if (originalBOnMessage) await originalBOnMessage(message)
		await a.write(message)
	}

	return {
		destroy: () => {
			// Restore original handlers
			a.onMessage = originalAOnMessage
			b.onMessage = originalBOnMessage
		}
	}
}
```

## Best Practices

### Use Unique Channel Names

Each relay should use a unique IPC channel:

```ts
// GOOD: Unique channels
const relay1 = createRelay(
	new ElectronIpcMainIO(ipcMain, webContents, "worker-1"),
	new NodeIo(p1.stdout, p1.stdin)
)
const relay2 = createRelay(
	new ElectronIpcMainIO(ipcMain, webContents, "worker-2"),
	new NodeIo(p2.stdout, p2.stdin)
)

// BAD: Same channel will conflict
const relay1 = createRelay(
	new ElectronIpcMainIO(ipcMain, webContents), // "kkrpc-ipc"
	new NodeIo(p1.stdout, p1.stdin)
)
const relay2 = createRelay(
	new ElectronIpcMainIO(ipcMain, webContents), // Also "kkrpc-ipc" ❌
	new NodeIo(p2.stdout, p2.stdin)
)
```

### Always Cleanup

```ts
app.on("window-all-closed", () => {
	relay.destroy() // Stop forwarding
	process.kill() // Terminate worker
})
```

### Match Channel Names

The channel name in Main must match the channel name in Renderer:

```ts
// main.ts
new ElectronIpcMainIO(ipcMain, webContents, "my-worker")

// renderer.ts
new ElectronIpcRendererIO("my-worker") // Same name! ✓
```

### Process Isolation

Use relay when you need process isolation:

- **CPU-intensive tasks**: Run in separate process to avoid blocking Main
- **Memory isolation**: Worker crashes don't crash Main
- **Different runtimes**: Use Node.js, Python, Rust, etc.
- **Security**: Sandboxed execution

## Comparison: Relay vs Direct RPC

### With Direct RPC (through Main)

```ts
// Main exposes worker API
const mainAPI = {
	calculate: (n) => workerAPI.calculate(n)
}

// Renderer calls through Main
await mainAPI.calculate(42) // Main → Worker → Result
```

**Pros:** Single connection, simple
**Cons:** Main must know all APIs, Main is bottleneck

### With Relay (transparent)

```ts
// Main just relays
const relay = createRelay(ipcIO, nodeIO)

// Renderer calls directly (through relay)
await workerAPI.calculate(42) // Renderer → Relay → Worker → Result
```

**Pros:** Clean separation, Main is transparent, scalable
**Cons:** Requires separate channel setup

## Complete Example

See `examples/electron-demo` for a complete working example with relay:

```bash
cd examples/electron-demo
npm install
npm run dev
```

The demo shows:

- Main ↔ Renderer IPC (default channel)
- Renderer → External Node Process (via relay on separate channel)
- Multiple communication patterns working together
