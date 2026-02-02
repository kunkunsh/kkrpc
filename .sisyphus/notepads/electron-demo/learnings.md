# Electron kkrpc Integration - Learnings & Notes

## Date: 2026-02-01

## Session: ses_3eda811e5ffecNE7cB2t1fexby

## What Was Built

### 1. Electron Adapters (packages/kkrpc/src/adapters/)

- **electron.ts**: `ElectronUtilityProcessIO` - Main process side adapter

  - Wraps Electron's `utilityProcess`
  - Uses `child.postMessage()` / `child.on('message')`
  - Follows WorkerParentIO pattern with message queue
  - Supports structuredClone capability

- **electron-child.ts**: `ElectronParentPortIO` - Child process side adapter
  - Wraps `process.parentPort` in utility process
  - Uses `process.parentPort.postMessage()` / `process.parentPort.on('message')`
  - Follows WorkerChildIO pattern
  - Supports structuredClone capability

### 2. Export Entry Point (packages/kkrpc/electron.ts)

- New entry point: `import { ... } from 'kkrpc/electron'`
- Exports both adapters + core kkrpc types
- Added to package.json exports
- Also fixed tsdown.config.ts to include electron.ts in build

### 3. Demo Application (examples/electron-demo/)

- **worker.ts**: Utility process script with WorkerAPI

  - Exposes: add(), multiply(), getProcessInfo(), pingMain()
  - Calls main API via bidirectional RPC

- **electron/main.ts**: Main process with RPC setup

  - Spawns utility process using `utilityProcess.fork()`
  - Sets up bidirectional RPC channel
  - Exposes MainAPI: showNotification(), getAppVersion()
  - Cleanup on window close

- **electron/preload.ts**: Exposes workerAPI via contextBridge
- **src/App.tsx**: React UI with buttons to test RPC calls
- **src/App.css**: Basic styling for the demo UI

## Key Implementation Details

### Message Queue Pattern

Both adapters use the standard kkrpc message queue pattern:

```typescript
private messageQueue: Array<string | IoMessage> = []
private resolveRead: ((value: string | IoMessage | null) => void) | null = null
```

### DESTROY_SIGNAL

Constant `__DESTROY__` used for cleanup, consistent with other adapters.

### Electron API Differences

- Main process: `utilityProcess.fork()` returns child with `postMessage/on`
- Child process: `process.parentPort` is global with `postMessage/on`
- No stdin support in utilityProcess (Electron limitation)
- Uses `child.kill()` and `process.exit()` for termination

### Type Safety

- Full TypeScript support with proper interface definitions
- WorkerAPI and MainAPI interfaces for type-safe RPC
- Global type declarations for window.workerAPI

## Challenges Encountered

1. **Stdio Limitation**: Electron utilityProcess doesn't support stdin, so we used postMessage exclusively (as decided in planning)

2. **Build Configuration**: Initially electron.ts wasn't in tsdown.config.ts, so dist files weren't generated. Fixed by adding to entry points.

3. **Type Definitions**: process.parentPort is Electron-specific, used @ts-ignore comments following the project's pattern (like worker.ts does for Deno)

4. **Context Bridge**: Needed to expose workerAPI via preload.ts for renderer process security

## Files Modified/Created

### packages/kkrpc/

- `src/adapters/electron.ts` (NEW)
- `src/adapters/electron-child.ts` (NEW)
- `electron.ts` (NEW)
- `package.json` (MODIFIED - added ./electron export)
- `tsdown.config.ts` (MODIFIED - added electron.ts to entry)

### examples/electron-demo/

- `worker.ts` (NEW)
- `electron/main.ts` (MODIFIED)
- `electron/preload.ts` (MODIFIED)
- `src/App.tsx` (MODIFIED)
- `src/App.css` (MODIFIED)
- `package.json` (MODIFIED - added kkrpc dependency)

## Verification Commands

```bash
# Type check kkrpc
cd packages/kkrpc && npx tsc --noEmit

# Build kkrpc (includes electron)
cd packages/kkrpc && bun run build

# Type check electron-demo
cd examples/electron-demo && npx tsc --noEmit

# Run demo
cd examples/electron-demo && npm run dev
```

## Next Steps (If Needed)

- Test the demo manually by clicking buttons
- Add more complex examples if desired
- Consider adding automated tests for the adapters
