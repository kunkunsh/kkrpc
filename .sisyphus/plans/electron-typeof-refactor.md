# Electron Demo typeof Refactor

## TL;DR

> **Refactor electron-demo to use `typeof` pattern instead of explicit interfaces**
>
> **Benefits**:
>
> - Single source of truth (implementation IS the type)
> - 56% reduction in type definition code (~92 lines → ~40 lines)
> - Shows kkrpc's elegance: type-safe RPC without writing types twice
>
> **Estimated Effort**: Small (4-5 focused tasks, ~1 hour)
> **Parallel Execution**: NO - Sequential dependency chain
> **Critical Path**: Update worker.ts → Update stdio-worker.ts → Update main.ts → Update App.tsx → Verify

---

## Context

### Current State (Duplicated Type Definitions)

| File              | Interface Lines | Pattern                          |
| ----------------- | --------------- | -------------------------------- |
| `worker.ts`       | 10 lines        | Explicit interface               |
| `stdio-worker.ts` | 12 lines        | Explicit interface               |
| `main.ts`         | 32 lines        | Explicit MainAPI                 |
| `App.tsx`         | 38 lines        | Duplicated MainAPI + RendererAPI |
| **Total**         | **92 lines**    | Duplicated, manual sync required |

**Problems**:

- MainAPI defined **twice** (main.ts AND App.tsx)
- Change implementation → must update interface separately
- Worker uses hacky late-binding for `pingMain`: `(workerMethods as WorkerAPI).pingMain = ...`

### Target State (typeof Pattern)

```typescript
// ← derived automatically

// main.ts - compose from derived types
import type { StdioWorkerAPI } from "../stdio-worker"
import type { WorkerAPI } from "../worker"

// worker.ts - implementation IS the type
export const workerAPI = {
	add: async (a: number, b: number) => a + b,
	multiply: async (a: number, b: number) => a * b
	// ... actual implementation
}
export type WorkerAPI = typeof workerAPI

type MainAPI = {
	worker: WorkerAPI
	stdio: StdioWorkerAPI
	// ... other methods
}
```

**Benefits**:

- ✅ Implementation changes auto-update types
- ✅ No duplication
- ✅ Shows kkrpc's "zero boilerplate" value
- ✅ Cleaner code (~50% less type definitions)

---

## Work Objectives

### Core Objective

Replace all explicit interface definitions with `typeof` pattern, deriving types directly from implementations.

### Concrete Deliverables

- `worker.ts`: Export `workerAPI` object + `type WorkerAPI = typeof workerAPI`
- `stdio-worker.ts`: Export `stdioWorkerAPI` object + `type StdioWorkerAPI = typeof stdioWorkerAPI`
- `main.ts`: Import types, define `MainAPI` using imported types, export for App.tsx
- `App.tsx`: Import `MainAPI` from main.ts (single source of truth)
- Fix `pingMain` late-binding with factory pattern

### Definition of Done

```bash
# All type definitions use typeof
grep "export type.*= typeof" worker.ts stdio-worker.ts
# Returns: type definitions found

# No explicit interface definitions remain
grep "export interface" worker.ts stdio-worker.ts || echo "0"
# Returns: 0

# TypeScript compiles
npx tsc --noEmit  # Success

# Type inference works in IDE
# mainAPI.worker.add(1, 2) returns Promise<number>
```

### Must Have

- [x] WorkerAPI derived from implementation using `typeof`
- [x] StdioWorkerAPI derived from implementation using `typeof`
- [x] MainAPI composed from imported WorkerAPI/StdioWorkerAPI types
- [x] MainAPI defined in main.ts, imported by App.tsx
- [x] pingMain uses factory pattern (no late-binding hack)
- [x] All 4 RPC paths still work (bidirectional)

### Must NOT Have (Guardrails)

- ❌ No separate `types.ts` file (types live with implementations)
- ❌ No `export interface` (use `export type` with `typeof`)
- ❌ No `(obj as Type).method = ...` late-binding
- ❌ No duplication of MainAPI (single source in main.ts)

---

## Verification Strategy

### Automated Verification

```bash
# 1. Verify typeof pattern used
grep -c "export type.*= typeof" examples/electron-demo/worker.ts
# Expected: 1

grep -c "export type.*= typeof" examples/electron-demo/stdio-worker.ts
# Expected: 1

# 2. Verify no explicit interfaces
grep -c "^export interface" examples/electron-demo/worker.ts || echo 0
# Expected: 0

grep -c "^export interface" examples/electron-demo/stdio-worker.ts || echo 0
# Expected: 0

# 3. TypeScript compilation
npx tsc --noEmit
# Expected: Success

# 4. Line count reduction
wc -l examples/electron-demo/worker.ts examples/electron-demo/stdio-worker.ts examples/electron-demo/electron/main.ts examples/electron-demo/src/App.tsx
# Should show ~50% reduction in type definition lines
```

### Manual Verification (IDE)

- [x] Hover over `mainAPI.worker.add()` shows correct return type
- [x] Autocomplete works on `mainAPI.worker.`
- [x] Autocomplete works on `mainAPI.stdio.`

---

## Execution Strategy

### Sequential Dependencies

```
Task 1: Refactor worker.ts (typeof pattern + factory) →
  Task 2: Refactor stdio-worker.ts (typeof pattern) →
    Task 3: Update main.ts (import types, compose MainAPI) →
      Task 4: Update App.tsx (import MainAPI from main.ts) →
        Task 5: Verify everything works
```

**Why Sequential**:

- App.tsx depends on MainAPI from main.ts
- main.ts depends on WorkerAPI/StdioWorkerAPI types
- WorkerAPI type depends on worker.ts implementation

---

## TODOs

### Task 1: Refactor worker.ts to use typeof Pattern

**File**: `examples/electron-demo/worker.ts`

**Current State** (lines 1-41):

```typescript
export interface WorkerAPI {
  add(a: number, b: number): Promise<number>
  multiply(a: number, b: number): Promise<number>
  getProcessInfo(): Promise<{...}>
  pingMain(message: string): Promise<string>
}

const workerMethods = {
  add: async (a: number, b: number) => a + b,
  multiply: async (a: number, b: number) => a * b,
  getProcessInfo: async () => ({...})
}

const io = new ElectronUtilityProcessChildIO()
const rpc = new RPCChannel<typeof workerMethods, MainAPI>(io, { expose: workerMethods })

// HACKY LATE-BINDING:
;(workerMethods as WorkerAPI).pingMain = async (message) => {
  await mainAPI.showNotification(`Worker says: ${message}`)
  return `Pinged main with: ${message}`
}
```

**Target State**:

```typescript
// Factory function to create worker API (avoids late-binding)
const createWorkerAPI = (rpc: RPCChannel<WorkerAPI, MainAPI>) => {
	const api = {
		add: async (a: number, b: number) => a + b,
		multiply: async (a: number, b: number) => a * b,
		getProcessInfo: async () => ({
			pid: process.pid,
			version: process.version,
			platform: process.platform
		}),
		pingMain: async (message: string) => {
			const mainAPI = rpc.getAPI()
			await mainAPI.showNotification(`Worker says: ${message}`)
			return `Pinged main with: ${message}`
		}
	}
	return api
}

// Export both implementation AND derived type
export const workerAPI = createWorkerAPI(rpc) // At runtime
export type WorkerAPI = ReturnType<typeof createWorkerAPI> // Derived type
```

**Must NOT do**:

- Don't use `export interface WorkerAPI`
- Don't use late-binding `(workerMethods as WorkerAPI).pingMain = ...`

**Acceptance Criteria**:

- [x] Uses `export type WorkerAPI = ...` (derived from impl)
- [x] No `export interface WorkerAPI`
- [x] pingMain uses factory pattern (accesses mainAPI via rpc.getAPI())
- [x] TypeScript compiles

---

### Task 2: Refactor stdio-worker.ts to use typeof Pattern

**File**: `examples/electron-demo/stdio-worker.ts`

**Current State**:

```typescript
export interface StdioWorkerAPI {
	calculateFactorial(n: number): Promise<number>
	calculateFibonacci(n: number): Promise<number>
	// ...
}
```

**Target State**:

```typescript
export const stdioWorkerAPI = {
  calculateFactorial: async (n: number) => { ... },
  calculateFibonacci: async (n: number) => { ... },
  getSystemInfo: async () => ({ ... }),
  executeCode: async (code: string) => { ... }
}

export type StdioWorkerAPI = typeof stdioWorkerAPI
```

**Acceptance Criteria**:

- [x] Uses `export type StdioWorkerAPI = typeof stdioWorkerAPI`
- [x] No `export interface StdioWorkerAPI`
- [x] TypeScript compiles

---

### Task 3: Update main.ts to Import and Compose Types

**File**: `examples/electron-demo/electron/main.ts`

**Current State** (lines 16-42):

```typescript
interface MainAPI {
	showNotification(message: string): Promise<void>
	getAppVersion(): Promise<string>
	pingRenderer(message: string): Promise<string>

	worker: {
		add(a: number, b: number): Promise<number>
		// ... 10 lines of nested interface
	}

	stdio: {
		factorial(n: number): Promise<number>
		// ... 8 lines of nested interface
	}
}
```

**Target State**:

```typescript
import type { WorkerAPI } from "../worker"
import type { StdioWorkerAPI } from "../stdio-worker"

// Define main's own methods
const mainMethods = {
  showNotification: async (message: string) => { ... },
  getAppVersion: async () => app.getVersion(),
  pingRenderer: async (message: string) => { ... }
}

// Compose full MainAPI using imported types
export type MainAPI = typeof mainMethods & {
  worker: WorkerAPI
  stdio: StdioWorkerAPI
}
```

**Must NOT do**:

- Don't redefine WorkerAPI/StdioWorkerAPI inline
- Don't duplicate method signatures

**Acceptance Criteria**:

- [x] Imports WorkerAPI and StdioWorkerAPI types
- [x] MainAPI composes imported types
- [x] Exports MainAPI type for App.tsx
- [x] TypeScript compiles

---

### Task 4: Update App.tsx to Import MainAPI from main.ts

**File**: `examples/electron-demo/src/App.tsx`

**Current State** (lines 5-37):

```typescript
// DUPLICATED MainAPI interface
interface MainAPI {
  showNotification(message: string): Promise<void>
  // ... 32 lines of duplicated interface
}

interface RendererAPI {
  showAlert(message: string): Promise<void>
  getRendererInfo(): Promise<{...}>
}
```

**Target State**:

```typescript
import type { MainAPI } from "../electron/main"

// Define renderer API implementation
const rendererAPI = {
  showAlert: async (message: string) => { ... },
  getRendererInfo: async () => ({ ... })
}

export type RendererAPI = typeof rendererAPI
```

**Acceptance Criteria**:

- [x] Imports MainAPI from "../electron/main"
- [x] No duplicate MainAPI interface in App.tsx
- [x] RendererAPI uses `typeof rendererAPI`
- [x] TypeScript compiles

---

### Task 5: Final Verification

**Verification**:

```bash
# 1. Check typeof pattern
grep "export type.*= typeof" worker.ts stdio-worker.ts

# 2. Check no explicit interfaces
grep "export interface" worker.ts stdio-worker.ts || echo "All clear"

# 3. TypeScript compilation
npx tsc --noEmit

# 4. IDE type inference check (manual)
# Hover over mainAPI.worker.add() should show Promise<number>
```

**Acceptance Criteria**:

- [x] All typeof patterns in place
- [x] No explicit interfaces
- [x] TypeScript compiles
- [x] Line count reduced by ~50%

---

## Success Criteria

### Before vs After

| Metric                      | Before   | After   | Change          |
| --------------------------- | -------- | ------- | --------------- |
| Total type definition lines | ~92      | ~40     | -56%            |
| MainAPI duplication         | 2 places | 1 place | Single source   |
| Interface keywords          | 4        | 0       | typeof only     |
| Late-binding hacks          | 1        | 0       | Factory pattern |

### Code Quality

- [x] Implementation changes auto-update types
- [x] No manual type sync needed
- [x] Shows kkrpc's "zero boilerplate" value

---

## Notes

### Method Name Mapping Preserved

Main.ts still maps shorter names to worker methods:

```typescript
// main.ts - keeps this mapping for API ergonomics
stdio: {
  factorial: async (n) => stdioAPI.calculateFactorial(n),  // rename kept
  fibonacci: async (n) => stdioAPI.calculateFibonacci(n),  // rename kept
}
```

This is intentional API design, not a workaround.

### Factory Pattern for pingMain

The late-binding hack is replaced with proper factory:

```typescript
// Before (hacky)
;(workerMethods as WorkerAPI).pingMain = async (msg) => { ... }

// After (clean)
const createWorkerAPI = (rpc: RPCChannel<...>) => ({
  pingMain: async (msg) => {
    const mainAPI = rpc.getAPI()  // Access via closure
    await mainAPI.showNotification(msg)
  }
})
```

---

## Post-Refactor Architecture

```
worker.ts
├── export const workerAPI = { ... }     # Implementation
└── export type WorkerAPI = typeof workerAPI  # Derived type

stdio-worker.ts
├── export const stdioWorkerAPI = { ... }
└── export type StdioWorkerAPI = typeof stdioWorkerAPI

electron/main.ts
├── import type { WorkerAPI } from "../worker"
├── import type { StdioWorkerAPI } from "../stdio-worker"
├── const mainMethods = { ... }
├── export type MainAPI = typeof mainMethods & {
│     worker: WorkerAPI
│     stdio: StdioWorkerAPI
│   }
└── main.ts also exports MainAPI for App.tsx

src/App.tsx
├── import type { MainAPI } from "../electron/main"
└── const rendererAPI = { ... }

Result: Single source of truth, no duplication, typeof everywhere!
```
