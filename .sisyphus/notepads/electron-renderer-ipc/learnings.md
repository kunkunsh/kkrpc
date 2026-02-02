# Electron Renderer-Main IPC Adapters - Learnings

## Date: 2026-02-01

## Session: ses_3eda811e5ffecNE7cB2t1fexby

## What Was Built

### 1. New kkrpc Adapters for Electron IPC

**ElectronIpcMainIO** (`packages/kkrpc/src/adapters/electron-ipc-main.ts`)

- Main process side adapter
- Uses `ipcMain.on()` for receiving messages from renderer
- Uses `webContents.send()` for sending messages to renderer
- Filters messages by `event.sender === webContents` to ensure correct window
- Follows standard kkrpc message queue pattern
- Supports structuredClone capability

**ElectronIpcRendererIO** (`packages/kkrpc/src/adapters/electron-ipc-renderer.ts`)

- Renderer process side adapter
- Uses `window.electron.ipcRenderer` (exposed via contextBridge)
- Sends via `ipcRenderer.send()`
- Listens via `ipcRenderer.on()`
- Requires preload script to expose ipcRenderer properly

### 2. Export Entry Point

**electron-ipc.ts** - New entry point `kkrpc/electron-ipc`

- Exports both adapters
- Exports core kkrpc types (RPCChannel, etc.)
- Added to package.json exports
- Added to tsdown.config.ts build entries

### 3. Demo Integration

**preload.ts** changes:

- Changed from `window.ipcRenderer` to `window.electron.ipcRenderer`
- Removed old `workerAPI` exposure (now uses kkrpc)
- Exposes only `send`, `on`, `off` methods (no `invoke`)

**main.ts** changes:

- Imports `ElectronIpcMainIO` from `kkrpc/electron-ipc`
- Creates RPC channel: `new ElectronIpcMainIO(ipcMain, win.webContents)`
- Exposes main API via RPC channel
- Removed old `ipcMain.handle()` registrations

**App.tsx** changes:

- Imports `ElectronIpcRendererIO` and `RPCChannel`
- Creates RPC channel at module level
- Gets typed API: `rpc.getAPI<MainAPI>()`
- Calls main API directly with type safety

## Key Implementation Details

### Message Queue Pattern

Both adapters use the standard kkrpc pattern:

```typescript
private messageQueue: Array<string | IoMessage> = []
private resolveRead: ((value: string | IoMessage | null) => void) | null = null
```

### DESTROY_SIGNAL

Constant `__DESTROY__` used for cleanup in both adapters.

### Type Safety

- Full TypeScript support across IPC boundary
- MainAPI interface defined in both main and renderer
- RPCChannel provides typed proxy API

### Security

- Uses `contextIsolation: true` (recommended)
- Uses `contextBridge` to expose ipcRenderer
- Does NOT use `nodeIntegration` (security risk)

## Challenges Encountered

1. **ipcRenderer Access**: Must be exposed via contextBridge, cannot import directly in renderer
2. **Window Filtering**: Main adapter must filter by `event.sender === webContents` to handle multiple windows
3. **Build Configuration**: Had to add electron-ipc.ts to tsdown.config.ts entry points

## Files Created/Modified

### packages/kkrpc/

- `src/adapters/electron-ipc-main.ts` (NEW)
- `src/adapters/electron-ipc-renderer.ts` (NEW)
- `electron-ipc.ts` (NEW)
- `package.json` (MODIFIED - added export)
- `tsdown.config.ts` (MODIFIED - added entry)

### examples/electron-demo/

- `electron/preload.ts` (MODIFIED)
- `electron/main.ts` (MODIFIED)
- `src/App.tsx` (MODIFIED)

## Verification

```bash
# Type check passes
cd packages/kkrpc && npx tsc --noEmit
cd examples/electron-demo && npx tsc --noEmit

# Build includes electron-ipc
cd packages/kkrpc && bun run build
# Generates: dist/electron-ipc.js, dist/electron-ipc.d.ts, etc.
```

## Usage Example

```typescript
// Main process
import { ElectronIpcMainIO, RPCChannel } from "kkrpc/electron-ipc"

const io = new ElectronIpcMainIO(ipcMain, win.webContents)
const rpc = new RPCChannel(io, { expose: mainAPI })

// Renderer process
import { ElectronIpcRendererIO, RPCChannel } from "kkrpc/electron-ipc"

const io = new ElectronIpcRendererIO()
const rpc = new RPCChannel<{}, MainAPI>(io, { expose: {} })
const mainAPI = rpc.getAPI()

// Call with full type safety!
await mainAPI.showNotification("Hello!")
const version = await mainAPI.getAppVersion()
```

## Benefits Over ipcMain.handle

1. **Type Safety**: Full TypeScript across IPC boundary
2. **No Manual Registration**: Just expose API object
3. **Nested APIs**: Support for `mainAPI.db.query()` patterns
4. **Cleaner Code**: Regular function calls instead of channel strings
