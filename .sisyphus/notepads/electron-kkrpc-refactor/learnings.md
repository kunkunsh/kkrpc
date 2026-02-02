## Electron kkrpc Refactor - Learnings

### Completed: 2026-02-02

## Key Patterns Learned

### 1. Unified MainAPI Pattern

Instead of exposing separate APIs through manual IPC handlers, consolidate everything into a single MainAPI with nested sub-APIs:

```typescript
interface MainAPI {
	// Direct methods
	showNotification(message: string): Promise<void>
	getAppVersion(): Promise<string>

	// Nested sub-APIs
	worker: {
		add(a: number, b: number): Promise<number>
		multiply(a: number, b: number): Promise<number>
		// ...
	}

	stdio: {
		factorial(n: number): Promise<number>
		fibonacci(n: number): Promise<number>
		// ...
	}
}
```

### 2. Delegation Pattern

MainAPI methods delegate to internal RPC channels:

```typescript
const mainAPI: MainAPI = {
	// ... direct methods

	worker: {
		add: async (a: number, b: number) => {
			if (!workerAPI) throw new Error("Worker not ready")
			return workerAPI.add(a, b)
		}
		// ...
	}
}
```

### 3. Eliminating Manual IPC

**Before (Mixed Pattern)**:

- `ipcMain.handle("worker:add", ...)` in main.ts
- `ipcRenderer.invoke("worker:add", ...)` in preload.ts
- `window.electronAPI.worker.add()` in App.tsx

**After (Pure kkrpc)**:

- `mainAPI.worker.add()` in App.tsx → kkrpc channel → MainAPI.worker.add() → workerAPI.add()

### 4. Preload Simplification

Only expose what kkrpc needs:

```typescript
// Keep this (kkrpc needs it)
contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: { send, on, off }
})

// Remove this (manual bridge, now obsolete)
contextBridge.exposeInMainWorld("electronAPI", { ... })
```

## Gotchas

1. **Worker Readiness**: Always check if workerAPI/stdioAPI is initialized before delegating
2. **Method Name Mapping**: MainAPI can use shorter names that map to longer worker method names (e.g., `factorial` → `calculateFactorial`)
3. **TypeScript**: Define MainAPI interface inline to avoid circular imports with worker files

## Verification Commands

```bash
# Ensure no manual IPC remains
grep -c "ipcMain.handle" electron/main.ts  # Should be 0
grep -c "window.electronAPI" src/App.tsx   # Should be 0
grep -c "electronAPI" electron/preload.ts  # Should be 0

# TypeScript compilation
npx tsc --noEmit  # Should pass
```

## Architecture Result

```
Renderer ──kkrpc───► MainAPI (unified, typed)
       IPC            ├─ worker: delegates to Worker RPC
                      ├─ stdio: delegates to Stdio RPC
                      └─ test: direct implementation
```

Single channel, full type safety, zero manual IPC handlers.
