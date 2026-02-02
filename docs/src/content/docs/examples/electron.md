---
title: Electron
description: Type-safe bidirectional RPC for Electron (Renderer ↔ Main ↔ Utility Process)
---

`kkRPC` provides type-safe bidirectional RPC communication for Electron applications. It supports three communication patterns:

1. **Renderer ↔ Main** (via IPC)
2. **Main ↔ Utility Process** (via postMessage)
3. **Renderer → External Process** (via Main relay)

## Package Structure

Electron has TWO separate sub-packages. This separation exists because different Electron processes run in different environments:

| Package          | Import Path          | Environment             | Use Case                              |
| ---------------- | -------------------- | ----------------------- | ------------------------------------- |
| **electron-ipc** | `kkrpc/electron-ipc` | Browser-like (Renderer) | Renderer ↔ Main communication        |
| **electron**     | `kkrpc/electron`     | Node.js (Main, Utility) | Main ↔ Utility Process communication |

### Why Two Packages?

**Environment Separation**: Electron's Renderer process runs in a Chromium sandbox with `contextIsolation: true`. It has NO access to Node.js APIs and requires `ipcRenderer` to be exposed via `contextBridge`. The `kkrpc/electron-ipc` package is designed specifically for this browser-like environment.

**Main and Utility Process**: Both run in full Node.js environments with access to `utilityProcess`, `child_process`, etc. The `kkrpc/electron` package includes Node.js-specific adapters.

### Where to Import From

```ts
// Renderer Process (Chromium sandbox)
// Utility Process (Node.js)
import { ElectronUtilityProcessChildIO, ElectronUtilityProcessIO } from "kkrpc/electron"
// Main Process (Node.js)
import { ElectronIpcMainIO, ElectronIpcRendererIO, RPCChannel } from "kkrpc/electron-ipc"
```

## Architecture Overview

```
┌─────────────────┐     IPC      ┌─────────────────┐   postMessage   ┌─────────────────┐
│   Renderer      │◄────────────►│      Main       │◄───────────────►│  Utility Process│
│  (Chromium)     │  kkrpc-ipc   │    (Node.js)    │                 │   (Node.js)     │
│                 │              │                 │                 │                 │
│ ElectronIpc     │              │ ElectronIpc     │                 │ ElectronUtility │
│ RendererIO      │              │ MainIO          │                 │ ProcessChildIO  │
│                 │              │                 │                 │                 │
│ kkrpc/          │              │ kkrpc/electron- │                 │ kkrpc/electron  │
│ electron-ipc    │              │ ipc             │                 │                 │
└─────────────────┘              └─────────────────┘                 └─────────────────┘
         │                                │
         │                                │  spawn(stdio)
         │                                │
         │                       ┌────────▼────────┐
         │                       │  External Node  │
         │                       │   Process       │
         │                       │  (via relay)    │
         │                       └─────────────────┘
         │
         │ Custom Channel (via relay)
         └──────────────────────────────────────────────┐
                                                        │
                                            ┌───────────▼───────────┐
                                            │   External Process    │
                                            │   (Node/Bun/Deno)     │
                                            │   via createRelay     │
                                            └───────────────────────┘
```

## Preload Script Setup

First, expose `ipcRenderer` via `contextBridge` in your preload script. This is REQUIRED for the renderer to communicate with main.

### Option 1: Secure IPC Bridge (Recommended)

Use the built-in `createSecureIpcBridge` factory for automatic channel whitelisting. This factory accepts the `ipcRenderer` from Electron and returns a secured version:

```ts title="preload.ts"
import { contextBridge, ipcRenderer } from "electron"
import { createSecureIpcBridge } from "kkrpc/electron-ipc"

const securedIpcRenderer = createSecureIpcBridge({
	ipcRenderer,
	channelPrefix: "kkrpc-"
})

contextBridge.exposeInMainWorld("electron", {
	ipcRenderer: securedIpcRenderer
})
```

This approach:

- Only allows IPC communication on channels starting with `"kkrpc-"`
- Blocks any other IPC channels (logged as warnings)
- Follows Electron security best practices
- Works with any Electron version (no direct Electron dependency in kkrpc)

You can also whitelist specific channels:

```ts title="preload.ts"
import { contextBridge, ipcRenderer } from "electron"
import { createSecureIpcBridge } from "kkrpc/electron-ipc"

const securedIpcRenderer = createSecureIpcBridge({
	ipcRenderer,
	allowedChannels: ["kkrpc-ipc", "kkrpc-worker-relay"]
})

contextBridge.exposeInMainWorld("electron", {
	ipcRenderer: securedIpcRenderer
})
```

### Option 2: Manual Setup

If you need custom behavior, set up the bridge manually:

```ts title="preload.ts"
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("electron", {
	ipcRenderer: {
		send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
		on: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.on(channel, listener),
		off: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.off(channel, listener)
	}
})
```

:::caution[Security Warning]
The manual setup exposes ALL IPC channels to the renderer. Consider using `createSecureIpcBridge` to whitelist only kkrpc channels.
:::

:::note[Security]
Both setups work with `contextIsolation: true` (recommended) and `nodeIntegration: false` for maximum security. The renderer has NO direct access to Node.js APIs.
:::

## API Definition

Define your API types that will be shared across processes:

```ts title="api.ts"
// Types shared across all processes
export interface MainAPI {
	showNotification(message: string): Promise<void>
	getAppVersion(): Promise<string>
	pingRenderer(message: string): Promise<string>
}

export interface RendererAPI {
	showAlert(message: string): Promise<void>
	getRendererInfo(): Promise<{
		userAgent: string
		language: string
		platform: string
	}>
}

export interface WorkerAPI {
	add(a: number, b: number): Promise<number>
	multiply(a: number, b: number): Promise<number>
	getProcessInfo(): Promise<{
		pid: number
		version: string
		platform: string
	}>
}
```

## Pattern 1: Renderer ↔ Main IPC

This is the most common pattern - communicating between the UI (Renderer) and the backend (Main).

### Main Process

```ts title="main.ts"
import { app, BrowserWindow, ipcMain } from "electron"
import { ElectronIpcMainIO, RPCChannel } from "kkrpc/electron-ipc"
import type { MainAPI, RendererAPI } from "./api"

const mainAPI: MainAPI = {
	showNotification: async (message: string) => {
		console.log(`[Main] Notification: ${message}`)
		win?.webContents.send("notification", message)
	},
	getAppVersion: async () => app.getVersion(),
	pingRenderer: async (message: string) => {
		// Call renderer methods
		const info = await rendererAPI.getRendererInfo()
		return `Renderer responded! Platform: ${info.platform}`
	}
}

// Create window
const win = new BrowserWindow({
	webPreferences: {
		preload: path.join(__dirname, "preload.js"),
		contextIsolation: true,
		nodeIntegration: false
	}
})

// Setup IPC
const ipcIO = new ElectronIpcMainIO(ipcMain, win.webContents)
const ipcRPC = new RPCChannel<MainAPI, RendererAPI>(ipcIO, { expose: mainAPI })
const rendererAPI = ipcRPC.getAPI()
```

### Renderer Process

```ts title="renderer.ts"
import { ElectronIpcRendererIO, RPCChannel } from "kkrpc/electron-ipc"
import type { MainAPI, RendererAPI } from "./api"

const rendererAPI: RendererAPI = {
	showAlert: async (message: string) => {
		alert(message)
		console.log("[Renderer] Alert shown:", message)
	},
	getRendererInfo: async () => ({
		userAgent: navigator.userAgent,
		language: navigator.language,
		platform: navigator.platform
	})
}

// Setup IPC (uses window.electron.ipcRenderer from preload)
const ipcIO = new ElectronIpcRendererIO()
const ipcRPC = new RPCChannel<RendererAPI, MainAPI>(ipcIO, { expose: rendererAPI })
const mainAPI = ipcRPC.getAPI()

// Call main process methods
await mainAPI.showNotification("Hello from renderer!")
const version = await mainAPI.getAppVersion()
```

:::tip[Bidirectional]
Notice both sides expose APIs and can call each other. The main process can call `rendererAPI.getRendererInfo()` and the renderer can call `mainAPI.showNotification()`.
:::

## Pattern 2: Main ↔ Utility Process

Utility Process is Electron's way to run Node.js code in a separate process. This is different from the Renderer process - it has full Node.js access.

### Main Process

```ts title="main.ts"
import { utilityProcess } from "electron"
import { ElectronUtilityProcessIO, RPCChannel } from "kkrpc/electron"
import type { MainAPI, WorkerAPI } from "./api"

// Fork utility process (separate Node.js process)
const workerPath = path.join(__dirname, "./worker.js")
const workerProcess = utilityProcess.fork(workerPath)

// Setup communication
const workerIO = new ElectronUtilityProcessIO(workerProcess)
const workerRPC = new RPCChannel<MainAPI, WorkerAPI>(workerIO, { expose: mainAPI })
const workerAPI = workerRPC.getAPI()

// Call worker methods
const result = await workerAPI.add(2, 3) // 5
const info = await workerAPI.getProcessInfo()
console.log(`Worker PID: ${info.pid}`)
```

### Utility Process (Worker)

```ts title="worker.ts"
import { ElectronUtilityProcessChildIO, RPCChannel } from "kkrpc/electron"
import type { MainAPI, WorkerAPI } from "./api"

const workerAPI: WorkerAPI = {
	add: async (a: number, b: number) => a + b,
	multiply: async (a: number, b: number) => a * b,
	getProcessInfo: async () => ({
		pid: process.pid,
		version: process.version,
		platform: process.platform
	})
}

const io = new ElectronUtilityProcessChildIO()
const rpc = new RPCChannel<WorkerAPI, MainAPI>(io, { expose: workerAPI })
const mainAPI = rpc.getAPI()

// Call back to main process
await mainAPI.showNotification("Hello from worker!")
```

## Pattern 3: Renderer → External Process (via Relay)

Connect the Renderer directly to an external Node.js/Bun/Deno process through Main using a transparent relay.

```
Renderer (IPC) → Main (relay) → External Node Process (stdio)
```

### Main Process (sets up relay)

```ts title="main.ts"
import { spawn } from "child_process"
import { createRelay, NodeIo } from "kkrpc"
import { ElectronIpcMainIO } from "kkrpc/electron-ipc"

// Spawn external Node.js process
const workerPath = path.join(__dirname, "./external-worker.js")
const workerProcess = spawn("node", [workerPath])

// Create transparent relay: IPC channel "external-relay" <-> stdio
const relay = createRelay(
	new ElectronIpcMainIO(ipcMain, win.webContents, "external-relay"),
	new NodeIo(workerProcess.stdout, workerProcess.stdin)
)

// Cleanup
app.on("window-all-closed", () => {
	relay.destroy()
	workerProcess.kill()
})
```

### Renderer Process (uses relay)

```ts title="renderer.ts"
import { ElectronIpcRendererIO, RPCChannel } from "kkrpc/electron-ipc"
import type { ExternalAPI } from "./api"

// Connect via the relay channel (NOT the default "kkrpc-ipc")
const io = new ElectronIpcRendererIO("external-relay")
const rpc = new RPCChannel<{}, ExternalAPI>(io)
const externalAPI = rpc.getAPI()

// Calls go directly to external process through Main's relay
const result = await externalAPI.heavyCalculation(1000)
```

### External Process

```ts title="external-worker.ts"
import { NodeIo, RPCChannel } from "kkrpc"
import type { ExternalAPI } from "./api"

const externalAPI: ExternalAPI = {
	heavyCalculation: async (n: number) => {
		// Heavy CPU work here
		return n * n
	}
}

const io = new NodeIo(process.stdin, process.stdout)
const rpc = new RPCChannel<ExternalAPI, {}>(io, { expose: externalAPI })
```

## Adapter Reference

| Adapter                         | Import Path          | Runs In  | Communication    | Protocol      |
| ------------------------------- | -------------------- | -------- | ---------------- | ------------- |
| `ElectronIpcMainIO`             | `kkrpc/electron-ipc` | Main     | Main ↔ Renderer | `ipcMain`     |
| `ElectronIpcRendererIO`         | `kkrpc/electron-ipc` | Renderer | Renderer ↔ Main | `ipcRenderer` |
| `ElectronUtilityProcessIO`      | `kkrpc/electron`     | Main     | Main ↔ Utility  | `postMessage` |
| `ElectronUtilityProcessChildIO` | `kkrpc/electron`     | Utility  | Utility ↔ Main  | `postMessage` |

## Complete Working Example

A complete working example with all three patterns is available in `examples/electron-demo`:

```bash
cd examples/electron-demo
npm install
npm run dev
```

The demo showcases:

- **Pattern 1**: Renderer → Main IPC with bidirectional calls
- **Pattern 2**: Main → Utility Process delegation
- **Pattern 3**: Renderer → External Node Process via relay
- **Multiple Channels**: Using separate IPC channels for different purposes

## Common Patterns

### Multiple Channels

You can create multiple IPC channels for different purposes:

```ts title="main.ts"
// Default channel for Main API
const defaultIO = new ElectronIpcMainIO(ipcMain, win.webContents)
const mainRPC = new RPCChannel<MainAPI, RendererAPI>(defaultIO, { expose: mainAPI })

// Separate channel for external process relay
const externalIO = new ElectronIpcMainIO(ipcMain, win.webContents, "external-channel")
const externalProcess = spawn("node", ["./worker.js"])
createRelay(externalIO, new NodeIo(externalProcess.stdout, externalProcess.stdin))
```

```ts title="renderer.ts"
// Default channel for Main API
const mainIO = new ElectronIpcRendererIO()
const mainRPC = new RPCChannel<RendererAPI, MainAPI>(mainIO, { expose: rendererAPI })

// Separate channel for External API
const externalIO = new ElectronIpcRendererIO("external-channel")
const externalRPC = new RPCChannel<{}, ExternalAPI>(externalIO)
```

### Cleanup

Always clean up resources when windows close:

```ts title="main.ts"
app.on("window-all-closed", () => {
	// Destroy all RPC channels
	ipcRPC?.destroy()
	workerRPC?.destroy()

	// Kill all child processes
	workerProcess?.kill()

	if (process.platform !== "darwin") {
		app.quit()
	}
})
```

## Troubleshooting

### "window.electron is undefined"

Make sure your preload script is correctly exposing `ipcRenderer`. The recommended approach:

```ts
// preload.ts - Use the secure bridge factory
import { contextBridge, ipcRenderer } from "electron"
import { createSecureIpcBridge } from "kkrpc/electron-ipc"

const securedIpcRenderer = createSecureIpcBridge({
	ipcRenderer,
	channelPrefix: "kkrpc-"
})

contextBridge.exposeInMainWorld("electron", {
	ipcRenderer: securedIpcRenderer
})
```

Or manually:

```ts
// preload.ts - Manual setup
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("electron", {
	ipcRenderer: {
		send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
		on: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.on(channel, listener),
		off: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.off(channel, listener)
	}
})
```

### "Cannot find module 'kkrpc/electron'"

Make sure you're importing from the correct package:

```ts
// WRONG - Renderer can't use Node.js packages
import { ElectronUtilityProcessIO } from "kkrpc/electron" // ❌

// CORRECT - Renderer uses electron-ipc
import { ElectronIpcRendererIO } from "kkrpc/electron-ipc" // ✓
```

### Channel Conflicts

Each `ElectronIpcMainIO` instance must have a unique channel name if you create multiple:

```ts
// These will conflict!
const io1 = new ElectronIpcMainIO(ipcMain, win.webContents) // Uses "kkrpc-ipc"
const io2 = new ElectronIpcMainIO(ipcMain, win.webContents) // Also "kkrpc-ipc" ❌

// Use unique channel names
const io1 = new ElectronIpcMainIO(ipcMain, win.webContents, "channel-1")
const io2 = new ElectronIpcMainIO(ipcMain, win.webContents, "channel-2") // ✓
```

## Features

- **Type-safe**: Full TypeScript support across all process boundaries
- **Bidirectional**: All processes can expose and call APIs
- **Secure**: Works with `contextIsolation: true` (recommended)
- **Flexible**: Three communication patterns (IPC, Utility Process, Relay)
- **Nested APIs**: Full support for nested method calls like `api.math.grade1.add()`
- **Error Preservation**: Complete error objects across process boundaries
- **Multiple Channels**: Support for separate IPC channels
