# Implement Event-Driven Relay

## TL;DR

> **Add onMessage hook to IoInterface for event-driven message handling**
>
> **Rewrite createRelay() to use callbacks instead of while loops**
>
> **Update electron-demo to use clean one-line relay API**
>
> **Result**: Main process becomes transparent byte pipe, zero API knowledge

---

## Work Objectives

### Core Changes

1. **Extend IoInterface** with optional `onMessage` callback
2. **Update adapters** to support event-driven mode (backward compatible)
3. **Rewrite relay.ts** using event callbacks
4. **Refactor electron-demo** to use new clean API

### Deliverables

1. Updated `packages/kkrpc/src/interface.ts`
2. Updated `packages/kkrpc/src/adapters/node.ts` (example adapter)
3. Updated `packages/kkrpc/src/adapters/electron-ipc-main.ts`
4. Rewritten `packages/kkrpc/src/relay.ts`
5. Refactored `examples/electron-demo/electron/main.ts`

---

## Execution Strategy

### Sequential Tasks

Task 1: Extend IoInterface with onMessage →
Task 2: Update NodeIo adapter →
Task 3: Update ElectronIpcMainIO adapter →
Task 4: Rewrite relay.ts with event callbacks →
Task 5: Refactor main.ts to use new relay API →
Task 6: Test and verify

---

## TODOs

### Task 1: Extend IoInterface with onMessage

**File**: `packages/kkrpc/src/interface.ts`

**Change**:
Add optional `onMessage` property to `IoInterface`:

```typescript
export interface IoInterface {
	name: string
	read(): Promise<Buffer | Uint8Array | string | null>
	write(data: string | Buffer | Uint8Array): Promise<void>

	// NEW: Event-driven message handling (optional)
	onMessage?: (message: string) => void | Promise<void>

	capabilities?: IoCapabilities
	destroy?(): void
	signalDestroy?(): void
	isDestroyed?(): boolean
}
```

**Acceptance Criteria**:

- [x] `onMessage` added to IoInterface
- [x] Backward compatible (optional property)
- [x] TypeScript compiles

---

### Task 2: Update NodeIo Adapter

**File**: `packages/kkrpc/src/adapters/node.ts`

**Current**: Uses while loop with read()

**Target**: Support both modes:

- If `onMessage` is set: Use event-driven (data event handler)
- If `onMessage` is not set: Use traditional queue mode (existing behavior)

**Implementation**:

```typescript
export class NodeIo implements IoInterface {
	name = "node"
	onMessage?: (message: string) => void | Promise<void>

	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private buffer = ""

	constructor(
		stdout: ReadableStream,
		private stdin: WritableStream
	) {
		// Handle incoming data
		stdout.on("data", (chunk: Buffer) => {
			this.buffer += chunk.toString()
			const lines = this.buffer.split("\n")
			this.buffer = lines.pop() || "" // Keep incomplete line

			for (const line of lines) {
				if (line.trim()) {
					if (this.onMessage) {
						// Event-driven mode
						this.onMessage(line)
					} else {
						// Traditional queue mode
						this.messageQueue.push(line)
						if (this.resolveRead) {
							this.resolveRead(line)
							this.resolveRead = null
						}
					}
				}
			}
		})
	}

	async read(): Promise<string | null> {
		// If onMessage is set, this shouldn't be called
		// But keep for backward compatibility
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift()!
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(data: string): Promise<void> {
		this.stdin.write(data + "\n")
	}
}
```

**Acceptance Criteria**:

- [x] `onMessage` property added
- [x] Event-driven mode works when onMessage is set
- [x] Traditional mode still works when onMessage is not set
- [x] TypeScript compiles

---

### Task 3: Update ElectronIpcMainIO Adapter

**File**: `packages/kkrpc/src/adapters/electron-ipc-main.ts`

**Similar changes as NodeIo**:

```typescript
export class ElectronIpcMainIO implements IoInterface {
	name = "electron-ipc-main"
	onMessage?: (message: string | IoMessage) => void | Promise<void>

	constructor(ipcMain: IpcMain, webContents: WebContents) {
		// ... existing setup ...

		ipcMain.on(this.channelName, (_event, message) => {
			if (this.onMessage) {
				// Event-driven mode
				this.onMessage(message)
			} else {
				// Traditional queue mode
				this.messageQueue.push(message)
				if (this.resolveRead) {
					this.resolveRead(message)
					this.resolveRead = null
				}
			}
		})
	}
}
```

**Acceptance Criteria**:

- [x] `onMessage` property added
- [x] Works in both modes
- [x] TypeScript compiles

---

### Task 4: Rewrite relay.ts

**File**: `packages/kkrpc/src/relay.ts`

**Before** (while loop):

```typescript
export function createRelay(a: IoInterface, b: IoInterface): Relay {
	let destroyed = false

	const aToB = async () => {
		while (!destroyed) {
			const msg = await a.read()
			await b.write(msg)
		}
	}
	// ...
}
```

**After** (event-driven):

```typescript
import type { IoInterface } from "./interface.ts"

export interface Relay {
	destroy: () => void
}

/**
 * Creates a transparent relay between two IoInterfaces.
 * Messages flow bidirectionally without parsing.
 * Main process doesn't need to know API details.
 */
export function createRelay(a: IoInterface, b: IoInterface): Relay {
	// Store original callbacks (if any)
	const originalAOnMessage = a.onMessage
	const originalBOnMessage = b.onMessage

	// A -> B: When A receives message, forward to B
	a.onMessage = async (message) => {
		// Call original handler if exists
		if (originalAOnMessage) {
			await originalAOnMessage(message)
		}
		// Forward to B
		await b.write(message as string)
	}

	// B -> A: When B receives message, forward to A
	b.onMessage = async (message) => {
		// Call original handler if exists
		if (originalBOnMessage) {
			await originalBOnMessage(message)
		}
		// Forward to A
		await a.write(message as string)
	}

	return {
		destroy: () => {
			// Restore original callbacks
			a.onMessage = originalAOnMessage
			b.onMessage = originalBOnMessage
			a.destroy?.()
			b.destroy?.()
		}
	}
}
```

**Acceptance Criteria**:

- [x] Uses event-driven approach (onMessage)
- [x] No while loops
- [x] Preserves original callbacks (composable)
- [x] TypeScript compiles

---

### Task 5: Refactor main.ts

**File**: `examples/electron-demo/electron/main.ts`

**Before**:

```typescript
const mainAPI: MainAPI = {
	// ... other methods ...
	stdio: new Proxy({} as StdioWorkerAPI, {
		get: (_, method: string) => {
			return (...args: any[]) => {
				return (stdioAPI as any)[method](...args)
			}
		}
	})
}

async function spawnStdioWorker() {
	const stdioWorkerPath = path.join(__dirname, "./stdio-worker.js")
	stdioProcess = spawn("node", [stdioWorkerPath])
	const io = new NodeIo(stdioProcess.stdout!, stdioProcess.stdin!)
	stdioRPC = new RPCChannel<MainAPI, StdioWorkerAPI>(io, { expose: mainAPI })
	stdioAPI = stdioRPC.getAPI()
}
```

**After** (clean relay):

```typescript
import { createRelay } from "kkrpc"

const mainAPI: MainAPI = {
	// ... other methods ...
	// NO stdio section! It's handled by relay
}

async function spawnStdioWorker() {
	const stdioWorkerPath = path.join(__dirname, "./stdio-worker.js")
	stdioProcess = spawn("node", [stdioWorkerPath])

	// Create relay: Renderer IPC <-> Stdio Worker
	// Main doesn't know the API - just pipes bytes!
	const relay = createRelay(
		new ElectronIpcMainIO(ipcMain, win.webContents), // From Renderer
		new NodeIo(stdioProcess.stdout!, stdioProcess.stdin!) // To Worker
	)

	// Store relay for cleanup
	;(stdioProcess as any).relay = relay
}
```

**Wait - there's an issue!**

If we use relay, Main doesn't expose stdio API anymore. But Renderer calls `mainAPI.stdio.calculateFactorial()`. With relay, those calls need to go through a separate channel.

**Better approach**: Keep Main's RPCChannel but route "stdio.\*" methods through relay.

Actually, let me think about this more carefully...

The cleanest solution for demo:

1. Keep current architecture (Renderer -> Main -> Worker)
2. But use relay internally for stdio section
3. OR: Make it so Renderer creates separate connection for stdio

For simplicity, let's do this:

```typescript
// Main creates TWO channels:
// 1. ipcRPC - for Main's own APIs
// 2. stdioRelay - transparent relay to worker

async function createWindow() {
	// ... setup window ...

	// Channel 1: Main's API
	const ipcIO = new ElectronIpcMainIO(ipcMain, win.webContents)
	ipcRPC = new RPCChannel<MainAPI, RendererAPI>(ipcIO, { expose: mainAPI })
	rendererAPI = ipcRPC.getAPI()

	// Channel 2: Stdio relay (separate IPC channel)
	// Renderer will create separate RPC for this
	setupStdioRelay()
}

function setupStdioRelay() {
	// Use a dedicated IPC channel for stdio
	const relayIO = new ElectronIpcMainIO(ipcMain, win.webContents, {
		channelName: "kkrpc-stdio-relay"
	})

	const workerIO = new NodeIo(stdioProcess.stdout!, stdioProcess.stdin!)

	const relay = createRelay(relayIO, workerIO)

	// Store for cleanup
	;(stdioProcess as any).relay = relay
}
```

Then in Renderer:

```typescript
// App.tsx
// Two separate RPC channels:

// 1. Main API channel
const mainIO = new ElectronIpcRendererIO()
const mainRPC = new RPCChannel(mainIO)
const mainAPI = mainRPC.getAPI()

// 2. Stdio Worker channel (through relay)
const stdioIO = new ElectronIpcRendererIO({ channelName: "kkrpc-stdio-relay" })
const stdioRPC = new RPCChannel<any, StdioWorkerAPI>(stdioIO)
const stdioAPI = stdioRPC.getAPI()

// Now call directly:
// mainAPI.showNotification()  // Goes to Main
// stdioAPI.calculateFactorial(5)  // Goes through relay to Worker!
```

This is much cleaner! Main doesn't know stdio API at all.

**Acceptance Criteria**:

- [x] Remove stdio from MainAPI type
- [x] Remove stdio delegation from mainAPI object
- [x] Setup relay for stdio (separate channel)
- [x] Update App.tsx to use separate channel for stdio
- [x] TypeScript compiles

---

### Task 6: Test and verify

**Verification**:

```bash
cd examples/electron-demo
npx tsc --noEmit  # TypeScript compiles
npm run dev       # Demo works

# Test:
# - Section 2 (Worker delegation) should work
# - Section 4 (Stdio through relay) should work
# - Main.ts should have NO stdio method definitions
```

**Acceptance Criteria**:

- [x] TypeScript compiles
- [x] All demo sections work
- [x] Main.ts is clean (no stdio delegation)

---

## Architecture Summary

### Before (Current)

```
Renderer ──IPC───► Main ──RPC───► Worker
              (knows API)
```

### After (Event-Driven Relay)

```
Renderer ──IPC───► Main (mainAPI)
       └─IPC───► Relay ──stdio───► Worker
              (transparent, no API knowledge)
```

### Key Improvements

1. **Event-Driven**: No blocking while loops
2. **Clean API**: One-line `createRelay(a, b)`
3. **Separation**: Main doesn't know Worker APIs
4. **Composable**: Can chain relays
5. **Backward Compatible**: Existing code still works

---

## Files to Modify

| File                                               | Changes                       |
| -------------------------------------------------- | ----------------------------- |
| `packages/kkrpc/src/interface.ts`                  | Add onMessage property        |
| `packages/kkrpc/src/adapters/node.ts`              | Support event-driven mode     |
| `packages/kkrpc/src/adapters/electron-ipc-main.ts` | Support event-driven mode     |
| `packages/kkrpc/src/relay.ts`                      | Rewrite with callbacks        |
| `examples/electron-demo/electron/main.ts`          | Use new relay API             |
| `examples/electron-demo/src/App.tsx`               | Create separate stdio channel |

---

## Notes

### Backward Compatibility

Existing code continues to work because `onMessage` is optional:

- Old adapters: Don't set onMessage, use read()/write()
- New adapters: Set onMessage for event-driven

### Performance

- **Before**: While loop polling, blocking
- **After**: Event-driven, zero CPU when idle

### Extensibility

With onMessage hook, we can build:

- Routers (route by method prefix)
- Middleware (logging, auth)
- Load balancers
- Protocol converters
