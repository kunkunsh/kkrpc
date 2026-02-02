# Electron kkrpc Demo

A comprehensive demonstration of **kkrpc** integration with Electron, showcasing type-safe bidirectional RPC across multiple process boundaries.

## Overview

This demo app illustrates how kkrpc enables seamless communication between:

- **Renderer Process** (React UI) ↔ **Main Process** (Node.js)
- **Main Process** ↔ **Utility Process** (Worker)
- **Utility Process** → **Main Process** (bidirectional)

## Demo Features

The demo UI provides three sections demonstrating different RPC patterns:

### 1. Renderer → Main (kkrpc IPC)

Direct RPC calls from the renderer process to the main process using `ElectronIpcRendererIO`.

- **`showNotification("Hello!")`**: Sends a notification message from renderer to main
- **`getAppVersion()`**: Retrieves the Electron app version from main process

### 2. Main → Worker (Utility Process)

RPC calls from main process to a utility process (worker) using `ElectronUtilityProcessIO`.

- **`add(2, 3)`**: Simple arithmetic operation in worker
- **`multiply(4, 5)`**: Another arithmetic operation demonstrating stateless calls
- **`getProcessInfo()`**: Returns worker process info (PID, Node version, platform)

### 3. Worker → Main (Bidirectional)

Demonstrates that the worker can also call back to the main process.

- **`pingMain("Hello!")`**: Worker calls main's `showNotification` API and returns a response

### 4. Renderer → Main → Stdio Worker (2-Layer Relay)

Demonstrates a 2-layer relay pattern where the renderer calls an external Node.js process through the main process:

- **`factorial(5)`**: Calculates factorial in external Node.js process
- **`fibonacci(n)`**: Calculates fibonacci with user input
- **`getSystemInfo()`**: Returns info about the external process (different PID than main)
- **`executeCode(code)`**: Executes arbitrary code (with security warning)

## Architecture

```
┌─────────────────┐     kkrpc IPC      ┌─────────────────┐
│  Renderer       │◄──────────────────►│  Main Process   │
│  (React UI)     │   (ipcRenderer)    │  (Node.js)      │
└─────────────────┘                    └────────┬────────┘
                                                │
                                                │ utilityProcess.fork()
                                                │
                                       ┌────────▼────────┐
                                       │  Utility        │
                                       │  Process        │
                                       │  (Worker)       │
                                       └─────────────────┘
```

### 2-Layer Relay Architecture (Stdio Worker)

```
┌─────────────────┐     kkrpc IPC      ┌─────────────────┐     kkrpc stdio      ┌─────────────────┐
│  Renderer       │◄──────────────────►│  Main Process   │◄───────────────────►│  External       │
│  (React UI)     │   (ipcRenderer)    │  (Node.js)      │   (stdin/stdout)    │  Node.js Proc   │
└─────────────────┘                    └────────┬────────┘                     └─────────────────┘
                                                 │
                                        ┌────────┴────────┐
                                        │  Utility        │
                                        │  Process        │
                                        │  (Worker)       │
                                        └─────────────────┘
```

### File Structure

```
electron-demo/
├── electron/
│   ├── main.ts          # Main process: sets up both RPC channels
│   └── preload.ts       # Preload script: exposes ipcRenderer securely
├── src/
│   ├── App.tsx          # React UI: uses ElectronIpcRendererIO
│   └── main.tsx         # Entry point
├── worker.ts            # Utility Process: uses ElectronUtilityProcessChildIO
├── stdio-worker.ts      # External Node.js Process: uses NodeIo (stdio)
└── README.md            # This file
```

## Why kkrpc Instead of Native Electron APIs?

### Native Electron Approach

Without kkrpc, you'd typically use:

```typescript
// Preload - expose individual methods
contextBridge.exposeInMainWorld("electronAPI", {
	showNotification: (msg) => ipcRenderer.invoke("show-notification", msg),
	getAppVersion: () => ipcRenderer.invoke("get-app-version")
	// Add more methods here...
})

// Main - handle each method individually
ipcMain.handle("show-notification", async (event, msg) => {
	// implementation
})

ipcMain.handle("get-app-version", async () => {
	return app.getVersion()
})
// Add more handlers here...
```

**Problems with native approach:**

1. **No type safety**: Parameters and return types are not checked at compile time
2. **Boilerplate**: Need to define handlers for every single method
3. **No nested APIs**: Can't easily expose nested objects like `api.math.add()`
4. **Manual serialization**: Error handling, callbacks require manual implementation
5. **Bidirectional complexity**: Making main call renderer methods is complex

### kkrpc Approach

With kkrpc, you get:

```typescript
// Define API once
type MainAPI = {
	showNotification(msg: string): Promise<void>
	getAppVersion(): Promise<string>
	math: {
		add(a: number, b: number): Promise<number>
	}
}

// Main - expose entire API in one line
const rpc = new RPCChannel(io, { expose: mainAPI })

// Renderer - get typed API proxy
const mainAPI = rpc.getAPI<MainAPI>()
await mainAPI.math.add(1, 2) // Fully typed!
```

**Benefits:**

1. **Full TypeScript support**: Autocomplete, type checking, refactoring
2. **Zero boilerplate**: No manual handler registration
3. **Nested API support**: `api.math.grade1.add()` works out of the box
4. **Bidirectional by default**: Both sides can expose and call APIs
5. **Error preservation**: Complete error objects across boundaries
6. **Callback support**: Pass functions as parameters

### Why Stdio Worker?

The stdio worker pattern enables:

1. **External Runtime**: Run code in a separate Node.js/Bun/Deno process
2. **Process Isolation**: Heavy computations don't block the main process
3. **Different Runtime Versions**: Use a different Node.js version than Electron
4. **Sandboxing**: Isolate untrusted code in a separate process
5. **Resource Management**: Kill/restart the worker independently

**Use Cases:**

- CPU-intensive calculations (fibonacci, prime numbers, etc.)
- Running user-provided scripts safely
- Using native modules that conflict with Electron's Node version
- Background processing without blocking UI

### 2-Layer Relay Code Example

**Main Process** bridges IPC and stdio:

```typescript
// Main spawns external process
const stdioProcess = spawn("node", ["stdio-worker.js"])
const io = new NodeIo(stdioProcess.stdout, stdioProcess.stdin)
const stdioRPC = new RPCChannel(io, { expose: mainAPI })
const stdioAPI = stdioRPC.getAPI()

// Main bridges renderer IPC to stdio
ipcMain.handle("stdio:factorial", async (n) => {
	return stdioAPI?.calculateFactorial(n)
})
```

**Renderer** calls through both layers:

```typescript
// Renderer calls main via IPC
const result = await window.electronAPI.stdio.factorial(5)
// Goes: Renderer → Main IPC → Main Handler → Stdio RPC → External Process
```

## Running the Demo

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

## Key Implementation Details

### Security

- Uses `contextIsolation: true` (recommended security practice)
- Uses `contextBridge` to expose APIs (not `nodeIntegration`)
- No direct Node.js access from renderer

### Type Safety

All APIs are fully typed:

```typescript
// MainAPI is shared between main and renderer
interface MainAPI {
	showNotification(message: string): Promise<void>
	getAppVersion(): Promise<string>
}

// Type-safe usage
const mainAPI = rpc.getAPI<MainAPI>()
await mainAPI.showNotification("Hello!") // ✓ TypeScript validates this
```

### Cleanup

Proper cleanup on window close:

```typescript
app.on("window-all-closed", () => {
	ipcRPC?.destroy() // Close renderer IPC
	rpcChannel?.destroy() // Close worker IPC
	workerProcess?.kill() // Terminate worker
})
```

## Learn More

- [kkrpc Documentation](https://kunkunsh.github.io/kkrpc/)
- [Electron Documentation](https://www.electronjs.org/docs/latest/)
- [Electron UtilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
