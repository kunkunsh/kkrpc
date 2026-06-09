# Electron Demo

**Generated:** 2026-02-03
**Location:** examples/electron-demo

## OVERVIEW

Comprehensive Electron app demonstrating 3-layer bidirectional RPC: Renderer↔Main↔Utility Process + stdio relay to external Node.js process. Shows all kkrpc Electron patterns.

## ARCHITECTURE

```
┌─────────────────┐  IPC (kkrpc-ipc)  ┌─────────────────┐  stdio relay  ┌─────────────────┐
│  React UI       │◄────────────────►│  Main Process   │◄─────────────►│  External Node  │
│  (Renderer)     │                   │  (Node.js)      │               │  (stdio-worker) │
└─────────────────┘                   └────────┬────────┘               └─────────────────┘
                                               │
                                               │ utilityProcess.fork()
                                               │
                                      ┌────────▼────────┐
                                      │  Utility Worker │
                                      │  (forked proc)  │
                                      └─────────────────┘
```

## STRUCTURE

```
electron-demo/
├── electron/
│   ├── main.ts          # Main process: 3 RPC channels
│   └── preload.ts       # Secure preload with contextBridge
├── src/
│   ├── App.tsx          # React UI with all RPC demos
│   └── main.tsx         # React entry
├── worker.ts            # Utility Process (Worker)
├── stdio-worker.ts      # External Node.js process
└── README.md            # Detailed docs
```

## KEY FILES

| File                  | Lines | Purpose                        |
| --------------------- | ----- | ------------------------------ |
| `electron/main.ts`    | 196   | Main process with 3 RPC setups |
| `src/App.tsx`         | 329   | React UI demoing all patterns  |
| `worker.ts`           | ~50   | Utility Process child          |
| `stdio-worker.ts`     | ~80   | External Node.js process       |
| `electron/preload.ts` | ~30   | Secure preload script          |

## RPC PATTERNS

### 1. Renderer ↔ Main (IPC)

```typescript
// Renderer
const ipcTransport = electronIpcTransport({ endpoint: window.electron.ipcRenderer, channel: "kkrpc-ipc" })
const rpc = new RPCChannel<RendererAPI, MainAPI>(ipcTransport, { expose: rendererAPI })
const mainAPI = rpc.getAPI()
await mainAPI.showNotification("Hello!")
```

### 2. Main ↔ Worker (UtilityProcess)

```typescript
// Main
const worker = utilityProcess.fork(workerPath)
const transport = electronUtilityProcessTransport(worker)
const rpc = new RPCChannel<MainAPI, WorkerAPI>(transport, { expose: mainAPI })
const workerAPI = rpc.getAPI()
await workerAPI.add(2, 3)
```

### 3. Renderer → External Process (Relay)

```typescript
// Main exposes a stdio worker through mainAPI.stdio
const stdioTransport = nodeStdioTransport({ readable: process.stdin, writable: process.stdout })
const rpc = new RPCChannel(stdioTransport)
const stdioAPI = rpc.getAPI()
```

## RUNNING

```bash
cd examples/electron-demo
pnpm install
pnpm dev
```

## FEATURES DEMOED

- **Renderer→Main**: `showNotification()`, `getAppVersion()`
- **Main→Worker**: `worker.add()`, `worker.multiply()`, `getProcessInfo()`
- **Worker→Main**: `pingMain()` (bidirectional)
- **Stdio Relay**: `factorial()`, `fibonacci()`, `executeCode()`

## SECURITY

- `contextIsolation: true` (no direct Node access)
- `nodeIntegration: false`
- `contextBridge` for secure API exposure
- Preload whitelists channels with prefix

## NOTES

- Shows all 3 Electron communication patterns
- Stdio worker demonstrates process isolation
- Relay pattern enables Renderer→External Process calls
- Full TypeScript types across all boundaries
