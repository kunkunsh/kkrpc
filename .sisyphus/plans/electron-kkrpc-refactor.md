# Electron kkrpc Refactor - Pure kkrpc IPC Pattern

## TL;DR

> **Refactor electron-demo to eliminate manual Electron IPC handlers and use pure kkrpc for all inter-process communication**
>
> **Deliverables**:
>
> - Unified MainAPI with nested worker/stdio/test sub-APIs
> - Zero manual `ipcMain.handle()` registrations
> - Simplified preload.ts exposing only kkrpc channel
> - App.tsx using only `mainAPI.*` (no `window.electronAPI`)
>
> **Estimated Effort**: Medium (3-5 focused tasks, ~1-2 hours)
> **Parallel Execution**: NO - Sequential dependency chain
> **Critical Path**: Update MainAPI interface → Implement delegation → Delete old handlers → Update App.tsx → Cleanup preload.ts

---

## Context

### Original Request

User wants to refactor the electron-demo to use kkrpc properly instead of mixing native Electron IPC (`ipcMain.handle()`/`ipcRenderer.invoke()`) with kkrpc. Currently the demo shows both patterns which defeats the purpose of demonstrating kkrpc's value proposition.

### Current State (Mixed Pattern - BAD)

```
Renderer ──kkrpc───► MainAPI (showNotification, getAppVersion)  ✓ Good
       IPC

Renderer ──manual──► ipcMain.handle("worker:add")  ✗ Bad
       IPC            → calls workerAPI.add()

Renderer ──manual──► ipcMain.handle("stdio:factorial")  ✗ Bad
       IPC            → calls stdioAPI.calculateFactorial()
```

### Target State (Pure kkrpc - GOOD)

```
Renderer ──kkrpc───► MainAPI {
       IPC            showNotification,
                      getAppVersion,
                      worker: { add, multiply, pingMain, ... },
                      stdio: { factorial, fibonacci, ... },
                      test: { pingRenderer }
                    }

                    (MainAPI internally delegates to worker/stdio RPCs)
```

### Why This Matters

- **Type Safety**: All API calls go through typed MainAPI
- **No Boilerplate**: No manual handler registration
- **Nested APIs**: kkrpc supports `mainAPI.worker.add()` naturally
- **Single Channel**: One IPC channel handles everything

---

## Work Objectives

### Core Objective

Consolidate all 3 RPC channels (Renderer IPC, Utility Worker, Stdio Worker) into a unified MainAPI exposed through kkrpc, eliminating all manual `ipcMain.handle()` bridges.

### Concrete Deliverables

- `main.ts`: Unified MainAPI interface with nested `worker`, `stdio`, `test` sub-objects; no `ipcMain.handle()` calls
- `preload.ts`: Exposes only `window.electron.ipcRenderer` for kkrpc; no manual bridge
- `App.tsx`: Uses only `mainAPI.*` for all calls; no `window.electronAPI` references
- TypeScript compiles with zero errors
- All 10 UI test cases work identically to before

### Definition of Done

```bash
# Code verification
$ grep -c "ipcMain.handle" examples/electron-demo/electron/main.ts
0

$ grep -c "window.electronAPI" examples/electron-demo/src/App.tsx
0

$ grep -c "electronAPI" examples/electron-demo/electron/preload.ts
0

# Build verification
$ cd examples/electron-demo && npm run build
# Success - no TypeScript errors

# Functional verification (manual UI test)
All 10 test buttons produce same results as before refactor
```

### Must Have

- [ ] MainAPI includes all worker methods: add, multiply, getProcessInfo, pingMain
- [ ] MainAPI includes all stdio methods: factorial, fibonacci, getSystemInfo, executeCode
- [ ] MainAPI includes test method: pingRenderer
- [ ] App.tsx calls use `mainAPI.worker.add()` not `window.electronAPI.worker.add()`
- [ ] All `ipcMain.handle()` registrations removed from main.ts
- [ ] All `window.electronAPI` bridge code removed from preload.ts
- [ ] Worker and stdio RPC channels remain (they're already correct)
- [ ] TypeScript compiles without errors

### Must NOT Have (Guardrails)

- ❌ No changes to worker.ts (already using kkrpc correctly)
- ❌ No changes to stdio-worker.ts (already using kkrpc correctly)
- ❌ No new API methods (scope: consolidation only)
- ❌ No UI layout/styling changes
- ❌ No worker respawn/retry logic (out of scope)
- ❌ No error recovery or health checks (out of scope)
- ❌ No manual user testing in acceptance criteria

---

## Verification Strategy

### Test Infrastructure Assessment

- **Exists**: npm scripts (`npm run dev`, `npm run build`)
- **Framework**: Vite + Electron + TypeScript
- **Test Strategy**: Automated verification + manual UI smoke tests

### If TDD Enabled

No TDD for this refactor - it's structural consolidation. Existing behaviors serve as regression tests.

### Automated Verification

**For Code Changes** (using grep via Bash):

```bash
# Verify no manual IPC handlers remain
grep -c "ipcMain.handle" examples/electron-demo/electron/main.ts || echo "0"
# Assert: Returns "0"

# Verify no window.electronAPI usage in App.tsx
grep -c "window.electronAPI" examples/electron-demo/src/App.tsx || echo "0"
# Assert: Returns "0"

# Verify preload is simplified
grep -c "electronAPI" examples/electron-demo/electron/preload.ts || echo "0"
# Assert: Returns "0"

# TypeScript build
$ cd examples/electron-demo && npm run build 2>&1
# Assert: Exit code 0, no "error TS" messages
```

**For Functional Verification** (Manual UI Testing):
| # | Button | Expected Result |
|---|--------|-----------------|
| 1 | showNotification | Main process console shows notification |
| 2 | getAppVersion | Displays app version in logs |
| 3 | add(2, 3) | Result: 5 |
| 4 | multiply(4, 5) | Result: 20 |
| 5 | getProcessInfo | Shows worker PID, Node version, platform |
| 6 | pingMain | Worker→Main call succeeds |
| 7 | factorial(5) | Result: 120 |
| 8 | fibonacci(10) | Result: 55 |
| 9 | Execute code | Evaluates JavaScript expression |
| 10 | Test Main→Renderer | Shows alert, logs renderer info |

---

## Execution Strategy

### Sequential Dependencies

This refactor is **NOT parallelizable** - each task depends on the previous:

```
Task 1: Update MainAPI interface →
  Task 2: Implement delegation methods →
    Task 3: Delete old IPC handlers →
      Task 4: Update App.tsx →
        Task 5: Cleanup preload.ts →
          Task 6: Verify build and run tests
```

**Why Sequential**:

- MainAPI interface must exist before App.tsx can use it
- App.tsx changes require main.ts implementation
- preload.ts cleanup can only happen after App.tsx stops using electronAPI

### Agent Dispatch Summary

| Task | Dependencies | Recommended Agent                                                  |
| ---- | ------------ | ------------------------------------------------------------------ |
| 1    | None         | delegate_task(category="quick", load_skills=[]) - Interface update |
| 2    | Task 1       | delegate_task(category="quick", load_skills=[]) - Implementation   |
| 3    | Task 2       | delegate_task(category="quick", load_skills=[]) - Deletion         |
| 4    | Task 3       | delegate_task(category="quick", load_skills=[]) - Consumer update  |
| 5    | Task 4       | delegate_task(category="quick", load_skills=[]) - Cleanup          |
| 6    | Task 5       | delegate_task(category="quick", load_skills=[]) - Verification     |

---

## TODOs

### Task 1: Update MainAPI Interface in main.ts

**What to do**:
Expand the `MainAPI` interface (lines 16-20) to include nested `worker`, `stdio`, and `test` sub-APIs that mirror the current `WorkerAPI` and `StdioWorkerAPI` structures.

**Current Interface**:

```typescript
interface MainAPI {
	showNotification(message: string): Promise<void>
	getAppVersion(): Promise<string>
	pingRenderer(message: string): Promise<string>
}
```

**Target Interface**:

```typescript
interface MainAPI {
	showNotification(message: string): Promise<void>
	getAppVersion(): Promise<string>
	pingRenderer(message: string): Promise<string>

	worker: {
		add(a: number, b: number): Promise<number>
		multiply(a: number, b: number): Promise<number>
		getProcessInfo(): Promise<{ pid: number; version: string; platform: string }>
		pingMain(message: string): Promise<string>
	}

	stdio: {
		factorial(n: number): Promise<number>
		fibonacci(n: number): Promise<number>
		getSystemInfo(): Promise<{ pid: number; platform: string; arch: string; nodeVersion: string }>
		executeCode(code: string): Promise<unknown>
	}

	test: {
		pingRenderer(
			message: string
		): Promise<{
			success: boolean
			message: string
			rendererInfo: { userAgent: string; language: string; platform: string }
		}>
	}
}
```

**Must NOT do**:

- Don't implement the methods yet (Task 2)
- Don't delete old handlers yet (Task 3)
- Don't change any other code

**Recommended Agent Profile**:

- **Category**: `quick` - Simple interface extension
- **Skills**: [] - No special skills needed
- **Rationale**: Pure TypeScript interface work, no complex logic

**Parallelization**:

- **Can Run In Parallel**: NO - Blocks Task 2
- **Blocks**: Task 2 (implementation needs interface)
- **Blocked By**: None

**References**:

- `examples/electron-demo/worker.ts:1-15` - WorkerAPI type definition to mirror
- `examples/electron-demo/stdio-worker.ts:1-20` - StdioWorkerAPI type definition to mirror
- `examples/electron-demo/electron/main.ts:16-20` - Current MainAPI interface

**Acceptance Criteria**:

- [ ] MainAPI interface includes nested `worker` object with 4 methods
- [ ] MainAPI interface includes nested `stdio` object with 4 methods
- [ ] MainAPI interface includes nested `test` object with 1 method
- [ ] TypeScript: `cd examples/electron-demo && npx tsc --noEmit` passes

---

### Task 2: Implement MainAPI Methods with Delegation

**What to do**:
Update the `mainAPI` object (lines 44-60) to implement the new nested APIs by delegating to the existing `workerAPI` and `stdioAPI` RPC channels.

**Current Implementation**:

```typescript
const mainAPI: MainAPI = {
	showNotification: async (message: string) => {
		console.log(`[Main] Notification: ${message}`)
		win?.webContents.send("notification", message)
	},
	getAppVersion: async () => app.getVersion(),
	pingRenderer: async (message: string) => {
		console.log(`[Main] Pinging renderer with: ${message}`)
		if (!rendererAPI) {
			throw new Error("Renderer API not available")
		}
		await rendererAPI.showAlert(`Message from Main: ${message}`)
		const info = await rendererAPI.getRendererInfo()
		console.log("[Main] Renderer info:", info)
		return `Renderer responded! Platform: ${info.platform}, Language: ${info.language}`
	}
}
```

**Target Implementation**:

```typescript
const mainAPI: MainAPI = {
	showNotification: async (message: string) => {
		console.log(`[Main] Notification: ${message}`)
		win?.webContents.send("notification", message)
	},
	getAppVersion: async () => app.getVersion(),
	pingRenderer: async (message: string) => {
		console.log(`[Main] Pinging renderer with: ${message}`)
		if (!rendererAPI) {
			throw new Error("Renderer API not available")
		}
		await rendererAPI.showAlert(`Message from Main: ${message}`)
		const info = await rendererAPI.getRendererInfo()
		console.log("[Main] Renderer info:", info)
		return `Renderer responded! Platform: ${info.platform}, Language: ${info.language}`
	},

	worker: {
		add: async (a: number, b: number) => {
			if (!workerAPI) throw new Error("Worker not ready")
			return workerAPI.add(a, b)
		},
		multiply: async (a: number, b: number) => {
			if (!workerAPI) throw new Error("Worker not ready")
			return workerAPI.multiply(a, b)
		},
		getProcessInfo: async () => {
			if (!workerAPI) throw new Error("Worker not ready")
			return workerAPI.getProcessInfo()
		},
		pingMain: async (message: string) => {
			if (!workerAPI) throw new Error("Worker not ready")
			return workerAPI.pingMain(message)
		}
	},

	stdio: {
		factorial: async (n: number) => {
			if (!stdioAPI) throw new Error("Stdio worker not ready")
			return stdioAPI.calculateFactorial(n)
		},
		fibonacci: async (n: number) => {
			if (!stdioAPI) throw new Error("Stdio worker not ready")
			return stdioAPI.calculateFibonacci(n)
		},
		getSystemInfo: async () => {
			if (!stdioAPI) throw new Error("Stdio worker not ready")
			return stdioAPI.getSystemInfo()
		},
		executeCode: async (code: string) => {
			if (!stdioAPI) throw new Error("Stdio worker not ready")
			return stdioAPI.executeCode(code)
		}
	},

	test: {
		pingRenderer: async (message: string) => {
			console.log("[Main] Testing pingRenderer...")
			if (!rendererAPI) {
				throw new Error("Renderer API not available")
			}
			if (!win || win.isDestroyed()) {
				throw new Error("Window not available")
			}
			try {
				await rendererAPI.showAlert(`Bidirectional test: ${message}`)
				const info = await rendererAPI.getRendererInfo()
				return {
					success: true,
					message: `Main successfully called renderer!`,
					rendererInfo: info
				}
			} catch (error) {
				console.error("[Main] Error calling renderer:", error)
				throw error
			}
		}
	}
}
```

**Must NOT do**:

- Don't delete the old IPC handlers yet (Task 3)
- Don't change worker spawning logic
- Don't add retry logic or complex error handling

**Recommended Agent Profile**:

- **Category**: `quick` - Straightforward delegation implementation
- **Skills**: [] - No special skills needed
- **Rationale**: Simple method forwarding with null checks

**Parallelization**:

- **Can Run In Parallel**: NO - Depends on Task 1
- **Blocks**: Task 3 (handlers can be deleted after this works)
- **Blocked By**: Task 1 (interface must exist first)

**References**:

- `examples/electron-demo/electron/main.ts:36-42` - workerAPI and stdioAPI variable declarations
- `examples/electron-demo/electron/main.ts:79-131` - Current ipcMain.handle() implementations to copy logic from
- `examples/electron-demo/worker.ts` - WorkerAPI method signatures
- `examples/electron-demo/stdio-worker.ts` - StdioWorkerAPI method signatures

**Acceptance Criteria**:

- [ ] mainAPI object includes worker sub-object with 4 methods delegating to workerAPI
- [ ] mainAPI object includes stdio sub-object with 4 methods delegating to stdioAPI
- [ ] mainAPI object includes test sub-object with 1 method (copied from current ipcMain.handle)
- [ ] Each method checks if API is ready and throws descriptive error if not
- [ ] TypeScript: `cd examples/electron-demo && npx tsc --noEmit` passes

---

### Task 3: Delete All ipcMain.handle() Registrations

**What to do**:
Delete lines 79-131 in main.ts which contain all the manual `ipcMain.handle()` registrations. These are now obsolete since kkrpc handles all IPC.

**Lines to Delete**:

- Line 79-81: `ipcMain.handle("worker:add", ...)`
- Line 83-85: `ipcMain.handle("worker:multiply", ...)`
- Line 87-89: `ipcMain.handle("worker:getProcessInfo", ...)`
- Line 91-93: `ipcMain.handle("worker:pingMain", ...)`
- Line 95-97: `ipcMain.handle("stdio:factorial", ...)`
- Line 99-101: `ipcMain.handle("stdio:fibonacci", ...)`
- Line 103-105: `ipcMain.handle("stdio:getSystemInfo", ...)`
- Line 107-109: `ipcMain.handle("stdio:executeCode", ...)`
- Line 111-131: `ipcMain.handle("test:pingRenderer", ...)`

**Must NOT do**:

- Don't delete any other code
- Don't modify the ipcMain import (still used by ElectronIpcMainIO)
- Don't delete the mainAPI object

**Recommended Agent Profile**:

- **Category**: `quick` - Simple deletion
- **Skills**: [] - No special skills needed
- **Rationale**: Pure deletion, no logic changes

**Parallelization**:

- **Can Run In Parallel**: NO - Depends on Task 2
- **Blocks**: Task 4 (App.tsx can only be updated after main.ts works)
- **Blocked By**: Task 2 (implementation must exist first)

**References**:

- `examples/electron-demo/electron/main.ts:79-131` - All ipcMain.handle() lines to delete

**Acceptance Criteria**:

- [ ] All `ipcMain.handle()` calls removed from main.ts
- [ ] File still compiles (no syntax errors from deletion)
- [ ] Verify: `grep -c "ipcMain.handle" examples/electron-demo/electron/main.ts` returns "0"

---

### Task 4: Update App.tsx to Use mainAPI Only

**What to do**:
Update all calls in App.tsx to use the unified `mainAPI` from kkrpc instead of `window.electronAPI`.

**Changes Required**:

1. **Delete Window.electronAPI type declaration** (lines 16-49)
   Remove the entire `declare global { interface Window { electronAPI: ... } }` block

2. **Update Section 2 calls** (lines 115-160):

   - Line 118: `window.electronAPI.worker.add(2, 3)` → `mainAPI.worker.add(2, 3)`
   - Line 129: `window.electronAPI.worker.multiply(4, 5)` → `mainAPI.worker.multiply(4, 5)`
   - Line 140: `window.electronAPI.worker.getProcessInfo()` → `mainAPI.worker.getProcessInfo()`
   - Line 154: `window.electronAPI.worker.pingMain("Hello!")` → `mainAPI.worker.pingMain("Hello!")`

3. **Update Section 4 calls** (lines 162-207):

   - Line 165: `window.electronAPI.stdio.factorial(5)` → `mainAPI.stdio.factorial(5)`
   - Line 176: `window.electronAPI.stdio.fibonacci(fibNumber)` → `mainAPI.stdio.fibonacci(fibNumber)`
   - Line 187: `window.electronAPI.stdio.getSystemInfo()` → `mainAPI.stdio.getSystemInfo()`
   - Line 201: `window.electronAPI.stdio.executeCode(codeInput)` → `mainAPI.stdio.executeCode(codeInput)`

4. **Update test call** (lines 209-222):
   - Line 212: `window.electronAPI.test.pingRenderer("Hello from UI!")` → `mainAPI.test.pingRenderer("Hello from UI!")`

**Must NOT do**:

- Don't change any UI logic or styling
- Don't change error handling patterns
- Don't remove the isLoading state management

**Recommended Agent Profile**:

- **Category**: `quick` - Find-and-replace style updates
- **Skills**: [] - No special skills needed
- **Rationale**: Simple reference updates from one API to another

**Parallelization**:

- **Can Run In Parallel**: NO - Depends on Task 3
- **Blocks**: Task 5 (preload cleanup can only happen after App.tsx stops using electronAPI)
- **Blocked By**: Task 3 (main.ts must not have handlers first)

**References**:

- `examples/electron-demo/src/App.tsx:16-49` - Type declarations to delete
- `examples/electron-demo/src/App.tsx:115-160` - Worker calls to update
- `examples/electron-demo/src/App.tsx:162-207` - Stdio calls to update
- `examples/electron-demo/src/App.tsx:209-222` - Test call to update

**Acceptance Criteria**:

- [ ] Window.electronAPI type declaration removed
- [ ] All `window.electronAPI.worker.*` calls changed to `mainAPI.worker.*`
- [ ] All `window.electronAPI.stdio.*` calls changed to `mainAPI.stdio.*`
- [ ] `window.electronAPI.test.pingRenderer` changed to `mainAPI.test.pingRenderer`
- [ ] Verify: `grep -c "window.electronAPI" examples/electron-demo/src/App.tsx` returns "0"
- [ ] TypeScript compiles without errors

---

### Task 5: Cleanup preload.ts

**What to do**:
Remove the manual `electronAPI` bridge from preload.ts since App.tsx no longer uses it.

**Current State**:

```typescript
contextBridge.exposeInMainWorld("electronAPI", {
	worker: {
		add: (a: number, b: number) => ipcRenderer.invoke("worker:add", a, b),
		multiply: (a: number, b: number) => ipcRenderer.invoke("worker:multiply", a, b),
		getProcessInfo: () => ipcRenderer.invoke("worker:getProcessInfo"),
		pingMain: (message: string) => ipcRenderer.invoke("worker:pingMain", message)
	},
	stdio: {
		factorial: (n: number) => ipcRenderer.invoke("stdio:factorial", n),
		fibonacci: (n: number) => ipcRenderer.invoke("stdio:fibonacci", n),
		getSystemInfo: () => ipcRenderer.invoke("stdio:getSystemInfo"),
		executeCode: (code: string) => ipcRenderer.invoke("stdio:executeCode", code)
	},
	test: {
		pingRenderer: (message: string) => ipcRenderer.invoke("test:pingRenderer", message)
	}
})
```

**Target State**:
Delete the entire `contextBridge.exposeInMainWorld("electronAPI", {...})` block (lines 20-36).

Keep only:

```typescript
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("electron", {
	ipcRenderer: {
		send(...args: Parameters<typeof ipcRenderer.send>) {
			const [channel, ...omit] = args
			return ipcRenderer.send(channel, ...omit)
		},
		on(...args: Parameters<typeof ipcRenderer.on>) {
			const [channel, listener] = args
			return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
		},
		off(...args: Parameters<typeof ipcRenderer.off>) {
			const [channel, ...omit] = args
			return ipcRenderer.off(channel, ...omit)
		}
	}
})
```

**Must NOT do**:

- Don't touch the `window.electron.ipcRenderer` exposure (kkrpc needs this)
- Don't change any method signatures in the kept code

**Recommended Agent Profile**:

- **Category**: `quick` - Simple deletion
- **Skills**: [] - No special skills needed
- **Rationale**: Pure deletion, no logic changes

**Parallelization**:

- **Can Run In Parallel**: NO - Depends on Task 4
- **Blocks**: Task 6 (verification)
- **Blocked By**: Task 4 (App.tsx must stop using electronAPI first)

**References**:

- `examples/electron-demo/electron/preload.ts:20-36` - Block to delete
- `packages/kkrpc/src/adapters/electron-ipc-renderer.ts` - Shows how ElectronIpcRendererIO uses window.electron.ipcRenderer

**Acceptance Criteria**:

- [ ] electronAPI bridge removed from preload.ts
- [ ] window.electron.ipcRenderer exposure preserved (kkrpc needs it)
- [ ] Verify: `grep -c "electronAPI" examples/electron-demo/electron/preload.ts` returns "0"
- [ ] TypeScript compiles without errors

---

### Task 6: Final Verification

**What to do**:
Run comprehensive verification to ensure the refactor is complete and working.

**Verification Steps**:

1. **Code Verification**:

   ```bash
   cd examples/electron-demo

   # Verify no manual IPC handlers
   count=$(grep -c "ipcMain.handle" electron/main.ts || echo "0")
   if [ "$count" -ne "0" ]; then echo "FAIL: Found $count ipcMain.handle calls"; exit 1; fi
   echo "PASS: No ipcMain.handle calls found"

   # Verify no window.electronAPI usage
   count=$(grep -c "window.electronAPI" src/App.tsx || echo "0")
   if [ "$count" -ne "0" ]; then echo "FAIL: Found $count window.electronAPI references"; exit 1; fi
   echo "PASS: No window.electronAPI references found"

   # Verify preload is simplified
   count=$(grep -c "electronAPI" electron/preload.ts || echo "0")
   if [ "$count" -ne "0" ]; then echo "FAIL: Found $count electronAPI references"; exit 1; fi
   echo "PASS: No electronAPI references in preload"
   ```

2. **Build Verification**:

   ```bash
   npm run build 2>&1
   # Assert: Exit code 0
   ```

3. **TypeScript Verification**:
   ```bash
   npx tsc --noEmit 2>&1
   # Assert: Exit code 0, no errors
   ```

**Recommended Agent Profile**:

- **Category**: `quick` - Verification only
- **Skills**: [] - Uses Bash commands
- **Rationale**: Automated verification via shell commands

**Parallelization**:

- **Can Run In Parallel**: NO - Must be last task
- **Blocks**: None (final task)
- **Blocked By**: Task 5 (all changes must be complete)

**References**:

- `examples/electron-demo/package.json` - Has build scripts

**Acceptance Criteria**:

- [ ] `grep -c "ipcMain.handle" electron/main.ts` returns "0"
- [ ] `grep -c "window.electronAPI" src/App.tsx` returns "0"
- [ ] `grep -c "electronAPI" electron/preload.ts` returns "0"
- [ ] `npm run build` succeeds
- [ ] `npx tsc --noEmit` succeeds
- [ ] (Optional manual) All 10 UI test cases work

---

## Commit Strategy

Since this is a single cohesive refactor, recommend **ONE commit**:

**Commit Message**:

```
refactor(electron-demo): unify all APIs under pure kkrpc pattern

- Consolidate WorkerAPI and StdioWorkerAPI into MainAPI with nested structure
- Remove all manual ipcMain.handle() registrations (15 handlers)
- Simplify preload.ts to only expose kkrpc channel
- Update App.tsx to use mainAPI.* for all calls
- Eliminate window.electronAPI bridge pattern

BREAKING CHANGE: No longer exposes window.electronAPI
```

**Files Changed**:

- `examples/electron-demo/electron/main.ts`
- `examples/electron-demo/electron/preload.ts`
- `examples/electron-demo/src/App.tsx`

---

## Success Criteria

### Verification Commands

```bash
cd examples/electron-demo

# 1. No manual IPC handlers
test $(grep -c "ipcMain.handle" electron/main.ts || echo 0) -eq 0 && echo "✓ No manual handlers" || echo "✗ Found handlers"

# 2. No window.electronAPI usage
test $(grep -c "window.electronAPI" src/App.tsx || echo 0) -eq 0 && echo "✓ No electronAPI usage" || echo "✗ Found usage"

# 3. Preload simplified
test $(grep -c "electronAPI" electron/preload.ts || echo 0) -eq 0 && echo "✓ Preload simplified" || echo "✗ Found electronAPI"

# 4. TypeScript compiles
npm run build >/dev/null 2>&1 && echo "✓ Build succeeds" || echo "✗ Build failed"
```

### Final Checklist

- [ ] All 15 `ipcMain.handle()` calls removed
- [ ] All `window.electronAPI.*` calls converted to `mainAPI.*`
- [ ] Preload only exposes `window.electron.ipcRenderer`
- [ ] TypeScript compiles without errors
- [ ] Build succeeds
- [ ] (Manual) UI test: showNotification works
- [ ] (Manual) UI test: getAppVersion works
- [ ] (Manual) UI test: worker.add(2, 3) returns 5
- [ ] (Manual) UI test: worker.multiply(4, 5) returns 20
- [ ] (Manual) UI test: stdio.factorial(5) returns 120
- [ ] (Manual) UI test: test.pingRenderer shows alert

---

## Notes

### Worker Readiness

The implementation in Task 2 includes readiness checks:

```typescript
if (!workerAPI) throw new Error("Worker not ready")
```

This preserves the existing behavior - if renderer calls before workers spawn, it fails fast with a clear error. The alternative (queuing calls) is out of scope.

### Bidirectional Pattern Preserved

The worker can still call back to main via the existing `MainAPI` exposure in the worker RPC channel (line 66 in main.ts). This is unchanged and should continue working.

### Type Reuse

The nested API types in MainAPI mirror the actual WorkerAPI and StdioWorkerAPI types but are defined inline. This is intentional to avoid import dependencies between main and worker files.

### Testing

Since this is a demo app, final verification requires manual UI testing. The 10 test cases in the acceptance criteria should be run to confirm identical behavior.

---

## Post-Refactor Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     RENDERER PROCESS                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  App.tsx                                                    ││
│  │  - Uses ElectronIpcRendererIO                               ││
│  │  - Calls mainAPI.showNotification()                         ││
│  │  - Calls mainAPI.worker.add()                               ││
│  │  - Calls mainAPI.stdio.factorial()                          ││
│  └──────────────────────┬──────────────────────────────────────┘│
│                         │ kkrpc IPC                             │
└─────────────────────────┼───────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│                         ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Main Process (main.ts)                                     ││
│  │  ┌─────────────────────────────────────────────────────┐    ││
│  │  │  MainAPI {                                          │    ││
│  │  │    showNotification()                               │    ││
│  │  │    getAppVersion()                                  │    ││
│  │  │    worker: { add, multiply, ... } ─────┐            │    ││
│  │  │    stdio: { factorial, fibonacci, ... }├─┐          │    ││
│  │  │    test: { pingRenderer }              │ │          │    ││
│  │  │  }                                        │          │    ││
│  │  └───────────────────────────────────────────┼────┬─────┘    ││
│  │                                              │    │          ││
│  │  ┌─────────────────────────┐                 │    │          ││
│  │  │  RPCChannel (kkrpc)     │◄────────────────┘    │          ││
│  │  │  - ElectronIpcMainIO    │                      │          ││
│  │  └─────────────────────────┘                      │          ││
│  │                                                   │          ││
│  │  ┌─────────────────┐  ┌─────────────────────┐     │          ││
│  │  │ workerAPI       │  │ stdioAPI            │     │          ││
│  │  │ (delegates to)  │  │ (delegates to)      │     │          ││
│  │  └────────┬────────┘  └──────────┬──────────┘     │          ││
│  └───────────┼──────────────────────┼────────────────┼──────────┘│
└──────────────┼──────────────────────┼────────────────┼───────────┘
               │ kkrpc                │ kkrpc          │
               ▼ stdio                ▼ stdio          ▼
        ┌──────────────┐      ┌──────────────┐
        │ Utility      │      │ Stdio Worker │
        │ Process      │      │ (Node.js)    │
        │ (worker.ts)  │      │ (stdio-*)    │
        └──────────────┘      └──────────────┘
```

**Key Improvement**: Single kkrpc channel from renderer to main, with main delegating to workers internally. No manual IPC handlers anywhere.
