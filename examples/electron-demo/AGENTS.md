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
const ipcIO = new ElectronIpcRendererIO()
const rpc = new RPCChannel(rendererAPI, MainAPI>(ipcIO, { expose: rendererAPI })
const mainAPI = rpc.getAPI()
await mainAPI.showNotification("Hello!")
```

### 2. Main ↔ Worker (UtilityProcess)

```typescript
// Main
const worker = utilityProcess.fork(workerPath)
const io = new ElectronUtilityProcessIO(worker)
const rpc = new RPCChannel<MainAPI, WorkerAPI>(io, { expose: mainAPI })
const workerAPI = rpc.getAPI()
await workerAPI.add(2, 3)
```

### 3. Renderer → External Process (Relay)

```typescript
// Main bridges IPC to stdio
const stdioIO = new NodeIo(process.stdout, process.stdin)
const ipcIO = new ElectronIpcMainIO(ipcMain, webContents, "kkrpc-stdio-relay")
const relay = createRelay(ipcIO, stdioIO)

// Renderer uses relay channel
const stdioIO = new ElectronIpcRendererIO("kkrpc-stdio-relay")
const rpc = new RPCChannel(stdioIO)
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
