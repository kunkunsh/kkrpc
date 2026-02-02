# Work Plan: Add Electron Stdio Example

## Overview

Add a stdio-based RPC example to the Electron demo that demonstrates a 2-layer relay pattern: Renderer ↔ Main ↔ External Node/Bun Process. This complements the existing Utility Process example and shows how kkrpc can bridge to external runtime processes.

## Context

The existing Electron demo shows:

- Renderer ↔ Main IPC (via electron-ipc adapters)
- Main ↔ Utility Process (via electron adapters)

This plan adds:

- Main ↔ External Node/Bun Process (via stdio/NodeIo)
- Renderer calling external process through Main as relay

## Tasks

### Task 1: Create stdio-worker.ts

**File**: `examples/electron-demo/stdio-worker.ts`

Create an external worker script that runs as a separate Node.js/Bun process and communicates via stdio.

**Requirements**:

- Import `NodeIo` and `RPCChannel` from `kkrpc`
- Define `MainAPI` interface (for callbacks to main)
- Define `StdioWorkerAPI` interface with methods:
  - `calculateFactorial(n: number): Promise<number>`
  - `calculateFibonacci(n: number): Promise<number>`
  - `getSystemInfo(): Promise<{pid, platform, arch, nodeVersion}>`
  - `executeCode(code: string): Promise<any>` (with safety warning comment)
- Create `NodeIo` using `process.stdin` and `process.stdout`
- Expose worker methods via `RPCChannel`
- Get main API proxy and notify when ready
- Add `console.error` logging for debugging

**Acceptance Criteria**:

- [ ] File compiles with TypeScript
- [ ] Can be run with `node stdio-worker.ts` or `bun stdio-worker.ts`
- [ ] Outputs "[StdioWorker] Process started" to stderr

### Task 2: Update electron/main.ts

**File**: `examples/electron-demo/electron/main.ts`

Add stdio process management and bridge it to the renderer IPC.

**Requirements**:

- Import `spawn` from `child_process`
- Import `NodeIo` from `kkrpc`
- Add `StdioWorkerAPI` interface import
- Add state variables:
  - `stdioProcess: ChildProcess | null`
  - `stdioRPC: RPCChannel<MainAPI, StdioWorkerAPI> | null`
  - `stdioAPI: StdioWorkerAPI | null`
- Create `spawnStdioWorker()` function:
  - Spawn `node` or `bun` process with `stdio-worker.ts`
  - Create `NodeIo` with process stdout/stdin
  - Create `RPCChannel` with mainAPI exposed
  - Store API proxy for use by renderer
- Add IPC handlers for stdio worker:
  - `ipcMain.handle("stdio:factorial", (n) => stdioAPI?.calculateFactorial(n))`
  - `ipcMain.handle("stdio:fibonacci", (n) => stdioAPI?.calculateFibonacci(n))`
  - `ipcMain.handle("stdio:getSystemInfo", () => stdioAPI?.getSystemInfo())`
  - `ipcMain.handle("stdio:executeCode", (code) => stdioAPI?.executeCode(code))`
- Update cleanup in `window-all-closed`:
  - Kill stdio process
  - Destroy stdio RPC channel
- Call `spawnStdioWorker()` in `app.whenReady()`

**Acceptance Criteria**:

- [ ] Main process spawns stdio worker on startup
- [ ] IPC handlers are registered
- [ ] Cleanup properly terminates stdio process
- [ ] TypeScript compiles without errors

### Task 3: Update src/App.tsx

**File**: `examples/electron-demo/src/App.tsx`

Add UI section for stdio worker demo.

**Requirements**:

- Add `StdioWorkerAPI` interface
- Add handlers:
  - `handleStdioFactorial()` - calls `window.electronAPI.stdio.factorial(5)`
  - `handleStdioFibonacci()` - calls fibonacci with user input
  - `handleStdioGetSystemInfo()` - displays process info
  - `handleStdioExecuteCode()` - executes simple code (with warning)
- Add new section in UI:
  - Title: "4. Renderer → Main → Stdio Worker (2-Layer Relay)"
  - Description explaining the architecture
  - Buttons for each stdio operation
  - Input field for fibonacci number
  - Input field for code execution
- Add to `window.electronAPI` type declaration:
  - `stdio: { factorial, fibonacci, getSystemInfo, executeCode }`

**Acceptance Criteria**:

- [ ] New UI section renders correctly
- [ ] Buttons call stdio worker through main relay
- [ ] Results display in log
- [ ] TypeScript types are correct

### Task 4: Update electron/preload.ts

**File**: `examples/electron-demo/electron/preload.ts`

Expose stdio worker methods to renderer.

**Requirements**:

- Add to `electronAPI`:
  - `stdio: {`
  - `factorial: (n: number) => ipcRenderer.invoke("stdio:factorial", n)`
  - `fibonacci: (n: number) => ipcRenderer.invoke("stdio:fibonacci", n)`
  - `getSystemInfo: () => ipcRenderer.invoke("stdio:getSystemInfo")`
  - `executeCode: (code: string) => ipcRenderer.invoke("stdio:executeCode", code)`
  - `}`

**Acceptance Criteria**:

- [ ] All stdio methods exposed via contextBridge
- [ ] TypeScript types match main process handlers

### Task 5: Update README.md

**File**: `examples/electron-demo/README.md`

Document the new stdio pattern.

**Requirements**:

- Add "4. Renderer → Main → Stdio Worker" to Demo Features section
- Add Architecture diagram showing 2-layer relay:
  ```
  Renderer → Main (kkrpc IPC)
                ↓
           Main → Stdio Worker (kkrpc stdio)
  ```
- Explain why this pattern is useful:
  - Run code in external Node/Bun/Deno runtime
  - Isolate heavy computations
  - Use different runtime versions
  - Sandbox untrusted code
- Add code example showing the 2-layer setup
- Compare with native Electron:
  - Without kkrpc: Manual IPC bridging, no type safety
  - With kkrpc: Type-safe, automatic bridging

**Acceptance Criteria**:

- [ ] README explains stdio pattern clearly
- [ ] Architecture diagram is accurate
- [ ] Code examples are correct

## Testing

### Manual Testing Steps

1. Run `npm run dev` in electron-demo
2. Verify stdio worker starts (check console)
3. Click "Calculate Factorial(5)" button
4. Verify result appears in log
5. Enter number and click "Calculate Fibonacci"
6. Verify result appears
7. Click "Get System Info"
8. Verify external process info displays
9. Close window and verify no zombie processes

### Verification Commands

```bash
# Type check
cd examples/electron-demo && npx tsc --noEmit

# Run demo
npm run dev
```

## Success Criteria

- [ ] All 5 tasks completed
- [ ] Demo runs without errors
- [ ] Stdio worker communicates correctly
- [ ] 2-layer relay works end-to-end
- [ ] README documents the pattern
- [ ] No zombie processes on exit
- [ ] TypeScript compiles with 0 errors

## Notes

- Use `node` for stdio worker (more universally available than bun)
- Add console.error logging for debugging
- Include safety warning about executeCode
- Keep factorial numbers small (avoid overflow)
- Fibonacci should warn about performance for n > 30
