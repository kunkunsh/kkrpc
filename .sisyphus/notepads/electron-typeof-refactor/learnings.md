## Electron typeof Refactor - Learnings

### Completed: 2026-02-02

## Key Patterns Learned

### 1. typeof Pattern for Type Derivation

Instead of defining interfaces separately from implementations, derive types directly from implementations:

```typescript
// BEFORE: Interface + Implementation (duplication)
export interface WorkerAPI {
  add(a: number, b: number): Promise<number>
  multiply(a: number, b: number): Promise<number>
}
const workerMethods: WorkerAPI = { ... }

// AFTER: Implementation IS the type (single source of truth)
const workerAPI = {
  add: async (a: number, b: number) => a + b,
  multiply: async (a: number, b: number) => a * b
}
export type WorkerAPI = typeof workerAPI
```

### 2. Composing Types from Imports

MainAPI can be composed from imported types:

```typescript
// main.ts
import type { WorkerAPI } from "../worker"
import type { StdioWorkerAPI } from "../stdio-worker"

const mainMethods = {
  showNotification: async (message: string) => { ... },
  getAppVersion: async () => app.getVersion()
}

export type MainAPI = typeof mainMethods & {
  worker: WorkerAPI
  stdio: StdioWorkerAPI
}
```

### 3. Avoiding Circular References

When a method needs to call back to the other side (like pingMain):

```typescript
// BEFORE: Late-binding hack (bad)
const workerMethods = { add: ..., multiply: ... }
const rpc = new RPCChannel<...>(io, { expose: workerMethods })
;(workerMethods as WorkerAPI).pingMain = async (msg) => {
  const mainAPI = rpc.getAPI()  // Works but hacky
}

// AFTER: Define all methods upfront (clean)
let rpc: RPCChannel<WorkerAPI, MainAPI>
const workerAPI = {
  add: ..., multiply: ...,
  pingMain: async (msg) => {
    const mainAPI = rpc.getAPI()  // Access via closure
    await mainAPI.showNotification(msg)
  }
}
export type WorkerAPI = typeof workerAPI
rpc = new RPCChannel<WorkerAPI, MainAPI>(io, { expose: workerAPI })
```

### 4. Single Source of Truth

Eliminate duplication by having one file define the type and others import it:

```typescript
// main.ts - defines MainAPI
export type MainAPI = ...

// App.tsx - imports MainAPI
import type { MainAPI } from "../electron/main"
```

## Results

| Metric                | Before   | After   | Change          |
| --------------------- | -------- | ------- | --------------- |
| Type definition lines | ~92      | ~40     | -56%            |
| MainAPI duplication   | 2 places | 1 place | Eliminated      |
| Interface keywords    | 4        | 0       | typeof only     |
| Late-binding hacks    | 1        | 0       | Factory pattern |

## Benefits

1. **Single Source of Truth**: Implementation changes auto-update types
2. **Less Code**: ~56% reduction in type definitions
3. **No Duplication**: Types defined once, imported where needed
4. **Self-Documenting**: The code IS the type definition
5. **Shows kkrpc's Value**: Demonstrates "zero boilerplate" RPC

## Verification Commands

```bash
cd examples/electron-demo

# Check typeof patterns
grep "export type.*= typeof" worker.ts stdio-worker.ts

# Verify no explicit interfaces
grep "^export interface" worker.ts stdio-worker.ts || echo "None found"

# TypeScript compilation
npx tsc --noEmit  # Should pass
```

## Architecture

```
worker.ts
├── const workerAPI = { ... }
└── export type WorkerAPI = typeof workerAPI

stdio-worker.ts
├── const stdioWorkerAPI = { ... }
└── export type StdioWorkerAPI = typeof stdioWorkerAPI

electron/main.ts
├── import type { WorkerAPI } from "../worker"
├── import type { StdioWorkerAPI } from "../stdio-worker"
├── const mainMethods = { ... }
└── export type MainAPI = typeof mainMethods & { worker: WorkerAPI, stdio: StdioWorkerAPI }

src/App.tsx
└── import type { MainAPI } from "../electron/main"
```

Result: Clean, maintainable, type-safe RPC with minimal boilerplate!
