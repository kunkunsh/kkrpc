# Better Relay Design - Event-Driven Approach

## Problems with Current Implementation

### 1. Proxy is Too Ugly

```typescript
// Current - user has to write this:
stdio: new Proxy({} as StdioWorkerAPI, {
	get: (_, method: string) => {
		return (...args: any[]) => {
			return (stdioAPI as any)[method](...args)
		}
	}
})
```

**Bad**: Users shouldn't write this complexity.

### 2. While Loop is Blocking

```typescript
// Current relay - brute force polling
while (!destroyed) {
	const msg = await a.read() // Blocks forever
	await b.write(msg)
}
```

**Bad**: Wastes CPU, not event-driven.

---

## Better Solution: Event-Driven IoInterface

### Core Insight

The essence of relay is: **connect two adapters' read/write streams**.

When adapter A receives a message → write to adapter B
When adapter B receives a message → write to adapter A

### Design: Add onMessage Hook to IoInterface

```typescript
// Extend IoInterface with optional callback
export interface IoInterface {
	name: string
	read(): Promise<string | IoMessage | null>
	write(message: string | IoMessage): Promise<void>

	// NEW: Event-driven message handling
	onMessage?: (message: string | IoMessage) => void | Promise<void>

	capabilities?: IoCapabilities
	destroy?(): void
	signalDestroy?(): void
}
```

### Relay Implementation (Clean!)

```typescript
// packages/kkrpc/src/relay.ts
export function createRelay(a: IoInterface, b: IoInterface): Relay {
	// When A receives message → forward to B
	a.onMessage = async (msg) => {
		await b.write(msg)
	}

	// When B receives message → forward to A
	b.onMessage = async (msg) => {
		await a.write(msg)
	}

	return {
		destroy: () => {
			a.onMessage = undefined
			b.onMessage = undefined
			a.destroy?.()
			b.destroy?.()
		}
	}
}
```

### User API (Super Clean!)

```typescript
// main.ts - no Proxy, no method enumeration!
import { createRelay } from "kkrpc"

// Just pipe the adapters together
const relay = createRelay(
	new ElectronIpcMainIO(ipcMain, win.webContents), // From Renderer
	new NodeIo(stdioProcess.stdout!, stdioProcess.stdin!) // To Worker
)

// That's it! Main doesn't know any API methods.
// Messages flow transparently: Renderer ↔ Worker
```

---

## Adapter Modifications Needed

Each adapter needs to call `onMessage` when data arrives:

### Example: NodeIo

```typescript
export class NodeIo implements IoInterface {
	onMessage?: (msg: string) => void | Promise<void>

	constructor(stdout: ReadableStream, stdin: WritableStream) {
		// ... existing setup ...

		// NEW: Use event-driven approach instead of blocking read()
		this.stdout.on("data", (chunk: Buffer) => {
			// Buffer and process lines (existing logic)
			const messages = this.bufferString(chunk.toString())
			for (const msg of messages) {
				// If onMessage is set, use it (event-driven)
				// Otherwise fall back to queue for read() compatibility
				if (this.onMessage) {
					this.onMessage(msg)
				} else {
					this.messageQueue.push(msg)
					this.resolveRead?.(msg)
				}
			}
		})
	}

	// read() now returns queued messages or waits
	async read(): Promise<string | null> {
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift()!
		}
		// If onMessage is set, read() shouldn't be called
		// But we keep it for backward compatibility
		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}
}
```

### Example: ElectronIpcMainIO

```typescript
export class ElectronIpcMainIO implements IoInterface {
	onMessage?: (msg: string | IoMessage) => void | Promise<void>

	constructor(ipcMain: IpcMain, webContents: WebContents) {
		// ... existing setup ...

		ipcMain.on(this.channelName, (_event, message) => {
			if (this.onMessage) {
				// Event-driven mode
				this.onMessage(message)
			} else {
				// Traditional queue mode
				this.messageQueue.push(message)
				this.resolveRead?.(message)
			}
		})
	}
}
```

---

## Benefits

| Aspect              | Before (Proxy)           | After (Event-Driven Relay)   |
| ------------------- | ------------------------ | ---------------------------- |
| **User Code**       | 8 lines of ugly Proxy    | 1 line: `createRelay(a, b)`  |
| **Performance**     | While loop polling       | Event-driven, zero CPU waste |
| **API Knowledge**   | Main still knows methods | Main knows **nothing**       |
| **Maintainability** | Add method → update Main | Add method → no change       |
| **Type Safety**     | Any types                | Fully typed via endpoints    |

---

## Migration Strategy

1. **Add `onMessage` to IoInterface** (backward compatible - optional)
2. **Update adapters** to support event-driven mode
3. **Implement new relay** using `onMessage`
4. **Deprecate old approaches**

---

## Advanced: Router Pattern

With this design, we can also build routers easily:

```typescript
// Route messages based on path prefix
const router = createRouter({
	"math.": mathWorkerIO,
	"db.": dbWorkerIO,
	"fs.": fsWorkerIO
})

// "math.add" → math worker
// "db.query" → db worker
```

---

## Summary

**The key insight**: Instead of Main creating RPCChannel and proxying methods, just **pipe the raw adapters together**.

- **Before**: Renderer → Main RPC → Main proxies → Worker RPC → Worker
- **After**: Renderer → Relay → Worker (Main just passes bytes!)

This is the true "transparent relay" you envisioned!
