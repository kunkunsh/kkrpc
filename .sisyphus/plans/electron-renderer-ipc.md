# Electron Renderer-Main IPC kkrpc Adapters

## TL;DR

> **Quick Summary**: Create new kkrpc adapters for Electron's renderer-to-main IPC, enabling type-safe bidirectional RPC between frontend (renderer) and backend (main process). Replaces manual `ipcMain.handle()` / `ipcRenderer.invoke()` with clean function calls.
>
> **Deliverables**:
>
> - `ElectronIpcRendererIO` - Renderer side adapter (uses `ipcRenderer`)
> - `ElectronIpcMainIO` - Main side adapter (uses `ipcMain` + `webContents`)
> - Export entry point `kkrpc/electron-ipc`
> - Updated demo showing renderer → main RPC
>
> **Estimated Effort**: Medium (~3-4 hours)
> **Parallel Execution**: NO - Sequential
> **Critical Path**: Adapters → Export → Demo integration

---

## Context

### Current Problem

Currently using `ipcMain.handle()` pattern:

```typescript
// Main - verbose handler registration
ipcMain.handle("worker:add", async (_event, a, b) => workerAPI?.add(a, b))
ipcMain.handle("worker:multiply", async (_event, a, b) => workerAPI?.multiply(a, b))
// ... one handler per API method

// Renderer - calling through ipcRenderer
const result = await ipcRenderer.invoke("worker:add", 2, 3)
```

**Problems**:

- No type safety across IPC boundary
- Manual handler registration for each method
- No nested API support (e.g., `api.database.query()`)
- Complex to maintain as API grows

### Solution

Use kkrpc with new IPC adapters:

```typescript
// Main - expose API object
const rpc = new RPCChannel(io, { expose: mainAPI })

// Renderer - call like regular functions
const result = await mainAPI.add(2, 3) // Type-safe, autocomplete works!
```

---

## Technical Design

### Architecture

**Two adapters needed:**

1. **ElectronIpcRendererIO** (Renderer process)

   - Wraps `ipcRenderer`
   - Sends via `ipcRenderer.send()` or `ipcRenderer.invoke()`
   - Listens via `ipcRenderer.on()`
   - Runs in browser/renderer context

2. **ElectronIpcMainIO** (Main process)
   - Wraps `ipcMain` and `webContents`
   - Listens via `ipcMain.on()`
   - Sends via `webContents.send()`
   - Needs reference to target `WebContents` (window)

### Communication Flow

```
Renderer                           Main
   |                                 |
   |-- ipcRenderer.send() --------->|-- ipcMain.on()
   |                                 |    (queue message)
   |                                 |-- RPCChannel.read()
   |                                 |-- Process message
   |                                 |-- Send response
   |<-- ipcRenderer.on() ------------|-- webContents.send()
   |                                 |
```

### Key Differences from UtilityProcess Adapter

| Aspect    | UtilityProcess         | Renderer-Main IPC                      |
| --------- | ---------------------- | -------------------------------------- |
| Transport | `postMessage`          | `ipcMain`/`ipcRenderer`                |
| Context   | Separate process       | Same process, different threads        |
| Security  | `contextIsolation`     | Must use `contextBridge`               |
| Channel   | Single connection      | One per window                         |
| Transfer  | `MessagePort` possible | `MessagePort` via `MessageChannelMain` |

---

## Work Objectives

### Core Objective

Implement bidirectional, type-safe RPC between Electron's renderer and main processes using kkrpc, eliminating the need for manual `ipcMain.handle()` registration and providing full TypeScript support across the IPC boundary.

### Concrete Deliverables

1. **ElectronIpcRendererIO** - Renderer side adapter
2. **ElectronIpcMainIO** - Main side adapter
3. **Export entry** - `kkrpc/electron-ipc` entry point
4. **Demo update** - Show renderer calling main process API directly

### Definition of Done

- [x] Both adapters implement `IoInterface` correctly
- [x] Bidirectional RPC works: renderer calls main methods, main can call renderer
- [x] TypeScript types flow across IPC boundary
- [x] Demo shows direct function calls (not ipcRenderer.invoke)
- [x] All type checks pass

### Must Have

- [x] Message queue pattern for async handling
- [x] DESTROY_SIGNAL for cleanup
- [x] structuredClone capability (Electron IPC supports it)
- [x] Unique channel naming to avoid collisions
- [x] Proper cleanup on window close

### Must NOT Have

- [x] NO direct nodeIntegration (use contextBridge)
- [x] NO transfer support initially (keep simple)
- [x] NO complex multi-window routing initially

---

## Implementation Plan

### Adapter 1: ElectronIpcRendererIO

**File**: `packages/kkrpc/src/adapters/electron-ipc-renderer.ts`

**Pattern** (similar to `ElectronParentPortIO`):

```typescript
export class ElectronIpcRendererIO implements IoInterface {
	name = "electron-ipc-renderer-io"
	private messageQueue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null

	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: false
	}

	constructor(private channel: string = "kkrpc-ipc") {
		// Setup ipcRenderer listener
		ipcRenderer.on(channel, this.handleMessage)
	}

	read(): Promise<string | IoMessage | null> {
		// Message queue pattern
	}

	write(message: string | IoMessage): Promise<void> {
		// Send via ipcRenderer.send(channel, message)
	}

	destroy(): void {
		// Cleanup listener, send DESTROY_SIGNAL
	}
}
```

**Key points**:

- Uses `ipcRenderer` (must be exposed via contextBridge)
- Channel name parameter to avoid collisions
- Normalizes incoming v2 WireEnvelope like other adapters

### Adapter 2: ElectronIpcMainIO

**File**: `packages/kkrpc/src/adapters/electron-ipc-main.ts`

**Pattern**:

```typescript
export class ElectronIpcMainIO implements IoInterface {
	name = "electron-ipc-main-io"
	private messageQueue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null

	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: false
	}

	constructor(
		private webContents: WebContents,
		private channel: string = "kkrpc-ipc"
	) {
		// Setup ipcMain listener
		ipcMain.on(channel, this.handleMessage)
	}

	read(): Promise<string | IoMessage | null> {
		// Message queue pattern
	}

	write(message: string | IoMessage): Promise<void> {
		// Send via webContents.send(channel, message)
	}

	destroy(): void {
		// Cleanup listener, send DESTROY_SIGNAL
	}
}
```

**Key points**:

- Takes `WebContents` reference (the window)
- Uses `ipcMain.on()` for receiving
- Uses `webContents.send()` for sending
- Must track which window sent message for response routing

### TypeScript Declarations

Need to add to `electron-types.d.ts`:

```typescript
declare global {
	interface Window {
		electron?: {
			ipcRenderer: {
				send(channel: string, ...args: any[]): void
				on(channel: string, listener: (event: any, ...args: any[]) => void): void
				off(channel: string, listener: (event: any, ...args: any[]) => void): void
				invoke(channel: string, ...args: any[]): Promise<any>
			}
		}
	}
}
```

Or expose via preload script properly.

---

## Execution Strategy

### Wave 1: Adapters (2 tasks)

- [x] 1a. Create ElectronIpcRendererIO adapter
- [x] 1b. Create ElectronIpcMainIO adapter

### Wave 2: Export Entry (1 task)

- [x] 2. Create `electron-ipc.ts` export entry point

### Wave 3: Demo Integration (2 tasks)

- [x] 3a. Update preload.ts to expose ipcRenderer properly
- [x] 3b. Update demo to show renderer → main RPC

### Wave 4: Verification (1 task)

- [x] 4. Type check and test

---

## Questions to Resolve

1. **Channel naming**: Use a single channel or dynamic channels per window?

   - Suggestion: Single channel + window ID in message routing

2. **ipcRenderer access**: How to expose to renderer?

   - Option A: Expose full ipcRenderer (security risk)
   - Option B: Expose only specific channel (recommended)
   - Option C: Use contextBridge with wrapper

3. **Multi-window support**:

   - Main adapter needs to know which window to send to
   - Each window needs separate RPC channel

4. **Error handling**:
   - Electron IPC errors are serialized (only message property)
   - Need to handle this in RPC channel

---

## Success Criteria

### Verification Commands

```bash
# Type check
cd packages/kkrpc && npx tsc --noEmit
cd examples/electron-demo && npx tsc --noEmit

# Demo test
cd examples/electron-demo && npm run dev
# Click buttons in UI - should call main process directly
```

### Expected Behavior

- Renderer calls `mainAPI.someMethod()` directly
- Types work across boundary (TypeScript autocomplete)
- No manual `ipcMain.handle()` registration needed
- Cleanup works when window closes

---

## Notes

### Comparison with Existing Approach

**Current (ipcMain.handle)**:

```typescript
// Main - 10+ lines per method
ipcMain.handle("db:query", async (e, sql) => db.query(sql))
ipcMain.handle("db:insert", async (e, table, data) => db.insert(table, data))
// ... more handlers

// Renderer - no types
const result = await ipcRenderer.invoke("db:query", "SELECT * FROM users")
```

**New (kkrpc)**:

```typescript
// Main - 3 lines total
const rpc = new RPCChannel(io, { expose: { db: dbAPI } })

// Renderer - full types
const result = await mainAPI.db.query("SELECT * FROM users") // Autocomplete works!
```

### Design Decisions

1. **Separate from utilityProcess adapters**: Renderer↔Main IPC is different from utilityProcess communication
2. **Use ipcMain.on not handle**: `handle` is request-response, `on` allows bidirectional
3. **Channel-based**: Multiple windows = multiple channels
4. **No transfer initially**: Keep simple, add MessagePort support later if needed
