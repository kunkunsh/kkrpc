# Electron kkrpc Integration Demo

## TL;DR

> **Quick Summary**: Create new Electron adapter for postMessage-based bidirectional RPC between Electron main process and utilityProcess workers. Adapter follows Worker adapter pattern with message queue and destroy signal. Export from `kkrpc/electron` entry point. Demo showcases bidirectional communication (main↔worker) with simple React UI.
>
> **Deliverables**:
>
> - `packages/kkrpc/src/adapters/electron.ts` - Main process adapter (wraps utilityProcess)
> - `packages/kkrpc/src/adapters/electron-child.ts` - Child process adapter (wraps parentPort)
> - `packages/kkrpc/electron.ts` - Export entry point
> - Updated `examples/electron-demo/` - Working demo with React UI
>
> **Estimated Effort**: Medium (~4-6 hours)
> **Parallel Execution**: NO - Sequential (adapters → export → demo)
> **Critical Path**: Adapters → Export config → Demo integration → Verification

---

## Context

### Original Request

Create Electron demo for kkrpc that demonstrates bidirectional RPC communication using Electron's `utilityProcess.fork()`. User specifically requested:

- New Electron adapters (similar to Tauri adapter pattern)
- Support for postMessage-based communication
- Bidirectional communication (main process ↔ utility process can both call each other)
- Moderate complexity demo (not as complex as tauri-demo)

### Interview Summary

**Key Decisions**:

- **Communication method**: Use postMessage ONLY (not stdio, due to Electron stdin limitation)
- **Adapter count**: 2 adapters - main process side and child process side
- **Export strategy**: New entry point `kkrpc/electron` (following chrome-extension pattern)
- **Demo scope**: Simple React UI showing bidirectional calls, two columns comparing approaches
- **Bidirectional**: Both main→worker and worker→main API calls demonstrated

**Research Findings**:

- Electron `utilityProcess` supports `postMessage()` / `process.parentPort.on('message')`
- Uses standard message queue pattern (like Worker adapters)
- Supports structuredClone for object passing
- Requires `app.ready` before spawning utility process
- DESTROY_SIGNAL pattern needed for cleanup

### Metis Review

**Identified Gaps** (addressed):

- Stdio stdin limitation: Resolved by using postMessage exclusively
- Child-side adapter: Creating separate adapter for process.parentPort
- Package entry point: `kkrpc/electron` confirmed
- Error handling: Timeout/rejection for crashed workers
- Lifecycle: Cleanup on window close/destroy signal

---

## Work Objectives

### Core Objective

Create a complete Electron integration for kkrpc with postMessage-based bidirectional RPC, enabling seamless communication between Electron main process and utilityProcess workers with full TypeScript type safety.

### Concrete Deliverables

1. **ElectronUtilityProcessIO** (`adapters/electron.ts`) - Main process adapter wrapping utilityProcess
2. **ElectronParentPortIO** (`adapters/electron-child.ts`) - Child process adapter wrapping parentPort
3. **Export entry** (`electron.ts`) - New package entry point `kkrpc/electron`
4. **Demo app** - Updated `examples/electron-demo/` with:
   - Worker script with API implementation
   - Main process integration
   - React UI with bidirectional call buttons
   - Type-safe API definitions

### Definition of Done

- [ ] Both adapters implement `IoInterface` correctly
- [ ] Bidirectional RPC works: main calls worker methods, worker calls main methods
- [ ] Demo runs with `npm run dev` and shows working communication
- [ ] TypeScript compilation passes without errors
- [ ] Cleanup works: killing worker terminates gracefully

### Must Have

- [ ] PostMessage-based communication (no stdio)
- [ ] Message queue pattern for async message handling
- [ ] DESTROY_SIGNAL constant for cleanup
- [ ] structuredClone capability declaration
- [ ] Error preservation across RPC boundary
- [ ] Type-safe API definitions in demo

### Must NOT Have (Guardrails)

- [ ] NO stdio-based communication (Electron limitation, user decided against)
- [ ] NO MessagePort transfer features (keep it simple)
- [ ] NO complex UI (no code editor, no Monaco)
- [ ] NO multiple runtime support (Node.js only, no bun/deno)
- [ ] NO advanced features (reconnection, pooling, batching)
- [ ] NO excessive error types or abstraction layers

---

## Verification Strategy

### Test Infrastructure Assessment

- **Infrastructure exists**: YES - Bun test runner exists in `packages/kkrpc/__tests__`
- **User wants tests**: Manual verification via demo (test infrastructure exists if needed later)
- **QA approach**: Manual verification with automated build/type-checking

### Manual Verification (Agent-Executable)

**Build Verification**:

```bash
cd packages/kkrpc && bun run build
# Expected: Builds successfully with electron.ts entry point

cd examples/electron-demo && npm install
# Expected: Dependencies install, kkrpc links correctly

cd examples/electron-demo && npm run dev
# Expected: Electron window opens without errors
```

**Type Safety Verification**:

```bash
cd packages/kkrpc && npx tsc --noEmit
# Expected: No TypeScript errors

cd examples/electron-demo && npx tsc --noEmit
# Expected: No TypeScript errors
```

**Runtime Verification (Agent performs via UI interaction)**:

```typescript
// Using playwright or manual verification:
1. Wait for Electron window to load
2. Click "Start Worker" button
3. Click "Call Worker: add(2, 3)"
4. Assert output shows "Result: 5"
5. Click "Call Worker: getProcessInfo()"
6. Assert output shows process info from worker
7. Click "Call Main from Worker: showNotification()"
8. Assert main process receives call (console log or UI feedback)
9. Click "Stop Worker"
10. Assert worker process terminates
```

---

## Execution Strategy

### Sequential Execution (No Parallelization)

```
Wave 1:
├── Task 1: Create Electron adapters
│   ├── 1a: ElectronUtilityProcessIO (main process)
│   └── 1b: ElectronParentPortIO (child process)

Wave 2:
└── Task 2: Create electron.ts export entry point

Wave 3:
└── Task 3: Update electron-demo with integration
    ├── 3a: Add kkrpc dependency and worker script
    ├── 3b: Update main.ts with RPC setup
    └── 3c: Create React UI components

Wave 4:
└── Task 4: Verification and cleanup
    ├── 4a: Build verification
    ├── 4b: Type check verification
    └── 4c: Runtime test (manual or playwright)
```

### Dependency Matrix

| Task | Depends On | Blocks     | Can Parallelize With |
| ---- | ---------- | ---------- | -------------------- |
| 1a   | None       | 1b, 2      | None                 |
| 1b   | None       | 2          | 1a                   |
| 2    | 1a, 1b     | 3a, 3b, 3c | None                 |
| 3a   | 2          | 3b, 3c     | None                 |
| 3b   | 2, 3a      | 4          | 3c                   |
| 3c   | 2          | 4          | 3b                   |
| 4    | 3b, 3c     | None       | None                 |

---

## TODOs

- [ ] 1. Create ElectronUtilityProcessIO adapter (main process side)

  **What to do**:

  - Create `packages/kkrpc/src/adapters/electron.ts`
  - Implement `IoInterface` for Electron utilityProcess
  - Wrap `child.postMessage()` for write
  - Wrap `child.on('message', ...)` for read
  - Use message queue pattern (see worker.ts)
  - Add message event listener on construction
  - Implement `destroy()` with DESTROY_SIGNAL

  **Must NOT do**:

  - Do NOT implement stdin support (Electron doesn't support it)
  - Do NOT add reconnection logic
  - Do NOT create abstract base classes

  **Recommended Agent Profile**:

  - **Category**: `unspecified-medium` - TypeScript adapter implementation
  - **Skills**: None needed (straightforward implementation following existing patterns)
  - **Rationale**: This is pattern-matching work following existing Worker adapter code

  **Parallelization**:

  - **Can Run In Parallel**: YES (with Task 1b)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2 (export entry)
  - **Blocked By**: None (can start immediately)

  **References**:

  - `packages/kkrpc/src/adapters/worker.ts:1-90` - WorkerParentIO pattern (message queue, event listeners)
  - `packages/kkrpc/src/adapters/worker.ts:4` - DESTROY_SIGNAL constant
  - `packages/kkrpc/src/interface.ts:12-19` - IoCapabilities (structuredClone: true)
  - `packages/kkrpc/src/adapters/chrome-extension.ts` - ChromePortIO (similar port-based pattern)
  - Electron docs: utilityProcess.postMessage() / on('message') API

  **WHY Each Reference**:

  - Worker adapter: Shows message queue pattern and destroy signal implementation
  - ChromePortIO: Similar port-based communication pattern (postMessage/onmessage)
  - Interface: structuredClone capability declaration

  **Acceptance Criteria**:

  - [ ] File created: `packages/kkrpc/src/adapters/electron.ts`
  - [ ] Class `ElectronUtilityProcessIO` implements `IoInterface`
  - [ ] Constructor accepts `UtilityProcess` from electron
  - [ ] `capabilities` includes `structuredClone: true`
  - [ ] `read()` uses message queue pattern (returns Promise, queues messages)
  - [ ] `write()` calls `this.child.postMessage()`
  - [ ] `destroy()` sends DESTROY_SIGNAL and cleans up listeners
  - [ ] No TypeScript errors (`npx tsc --noEmit` passes)

  **Commit**: NO (part of Task 1 group commit)

---

- [ ] 1b. Create ElectronParentPortIO adapter (child process side)

  **What to do**:

  - Create `packages/kkrpc/src/adapters/electron-child.ts`
  - Implement `IoInterface` for child process parentPort
  - Wrap `process.parentPort.postMessage()` for write
  - Wrap `process.parentPort.on('message', ...)` for read
  - Use message queue pattern
  - Implement `destroy()` with DESTROY_SIGNAL

  **Must NOT do**:

  - Do NOT add stdin handling (not available)
  - Do NOT add extra abstraction layers

  **Recommended Agent Profile**:

  - **Category**: `unspecified-medium`
  - **Skills**: None needed
  - **Rationale**: Mirror of Task 1a, symmetrical pattern

  **Parallelization**:

  - **Can Run In Parallel**: YES (with Task 1a)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2 (export entry)
  - **Blocked By**: None

  **References**:

  - `packages/kkrpc/src/adapters/worker.ts:93-183` - WorkerChildIO pattern (child side)
  - `packages/kkrpc/src/adapters/worker.ts:4` - DESTROY_SIGNAL constant
  - Electron docs: process.parentPort API in utility process

  **Acceptance Criteria**:

  - [ ] File created: `packages/kkrpc/src/adapters/electron-child.ts`
  - [ ] Class `ElectronParentPortIO` implements `IoInterface`
  - [ ] Uses global `process.parentPort` (available in Electron utility process)
  - [ ] `capabilities` includes `structuredClone: true`
  - [ ] `read()` uses message queue pattern
  - [ ] `write()` calls `process.parentPort.postMessage()`
  - [ ] `destroy()` sends DESTROY_SIGNAL
  - [ ] No TypeScript errors

  **Commit**: YES (Task 1 group: "feat(adapters): add Electron utilityProcess adapters")

  - Message: `feat(kkrpc): add Electron utilityProcess adapters for postMessage RPC`
  - Files: `packages/kkrpc/src/adapters/electron.ts`, `packages/kkrpc/src/adapters/electron-child.ts`
  - Pre-commit: `cd packages/kkrpc && npx tsc --noEmit`

---

- [ ] 2. Create electron.ts export entry point

  **What to do**:

  - Create `packages/kkrpc/electron.ts`
  - Re-export Electron adapters
  - Follow pattern from `chrome-extension.ts` or `http.ts`
  - Update `package.json` exports to include `"./electron": "./electron.ts"`

  **Must NOT do**:

  - Do NOT export non-Electron adapters here
  - Do NOT add extra exports beyond the two adapters

  **Recommended Agent Profile**:

  - **Category**: `quick`
  - **Skills**: None
  - **Rationale**: Simple re-export file

  **Parallelization**:

  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 3 (demo integration)
  - **Blocked By**: Task 1a, Task 1b

  **References**:

  - `packages/kkrpc/chrome-extension.ts` - Export pattern example
  - `packages/kkrpc/package.json` - exports field structure

  **Acceptance Criteria**:

  - [ ] File created: `packages/kkrpc/electron.ts`
  - [ ] Exports `ElectronUtilityProcessIO` from `./src/adapters/electron`
  - [ ] Exports `ElectronParentPortIO` from `./src/adapters/electron-child`
  - [ ] `package.json` updated with `"./electron": "./electron.ts"` export
  - [ ] Can import via `import { ... } from 'kkrpc/electron'`
  - [ ] No TypeScript errors

  **Commit**: YES

  - Message: `feat(kkrpc): add kkrpc/electron entry point`
  - Files: `packages/kkrpc/electron.ts`, `packages/kkrpc/package.json`
  - Pre-commit: `cd packages/kkrpc && npx tsc --noEmit`

---

- [ ] 3a. Setup electron-demo kkrpc dependency and worker script

  **What to do**:

  - Add `kkrpc` as dependency in `examples/electron-demo/package.json`
  - Create `examples/electron-demo/worker.ts` - Utility process script
  - Worker exposes API: add(), multiply(), getProcessInfo(), pingMain()
  - Worker calls main API: showNotification()

  **Must NOT do**:

  - Do NOT add complex API (just basic math + process info)
  - Do NOT use stdio (postMessage only)

  **Recommended Agent Profile**:

  - **Category**: `unspecified-medium`
  - **Skills**: None
  - **Rationale**: Demo setup work

  **Parallelization**:

  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 3b
  - **Blocked By**: Task 2

  **References**:

  - `examples/tauri-demo/sample-script/node.js` - Worker script pattern
  - `packages/kkrpc/src/adapters/electron-child.ts` - How to use in worker

  **Acceptance Criteria**:

  - [ ] `package.json` updated with `"kkrpc": "workspace:*"` dependency
  - [ ] `worker.ts` created in `examples/electron-demo/`
  - [ ] Worker imports `ElectronParentPortIO` from `kkrpc/electron`
  - [ ] Worker exposes API with math operations
  - [ ] Worker calls main.showNotification() via RPC
  - [ ] Runs without errors

  **Commit**: NO (part of Task 3 group)

---

- [ ] 3b. Update electron-demo main.ts with RPC setup

  **What to do**:

  - Import `ElectronUtilityProcessIO` from `kkrpc/electron`
  - Import `RPCChannel` from `kkrpc`
  - Create spawnWorker() function using `utilityProcess.fork()`
  - Setup bidirectional RPC with worker
  - Expose main API: showNotification(), getAppVersion()
  - Handle cleanup on window close

  **Must NOT do**:

  - Do NOT spawn worker before `app.whenReady()`
  - Do NOT forget cleanup on window close

  **Recommended Agent Profile**:

  - **Category**: `unspecified-medium`
  - **Skills**: None
  - **Rationale**: Main process integration

  **Parallelization**:

  - **Can Run In Parallel**: YES (with Task 3c)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 4
  - **Blocked By**: Task 2, Task 3a

  **References**:

  - `examples/electron-demo/electron/main.ts` - Current main process
  - `examples/tauri-demo/src/backend/node.ts` - Similar spawn pattern
  - Electron docs: utilityProcess.fork() API

  **Acceptance Criteria**:

  - [ ] `main.ts` imports from `kkrpc/electron`
  - [ ] Worker spawned after `app.whenReady()`
  - [ ] RPC channel created with `ElectronUtilityProcessIO`
  - [ ] Main exposes `showNotification()` and `getAppVersion()`
  - [ ] Cleanup on window close (kill worker, destroy channel)
  - [ ] Exposes API to renderer via contextBridge

  **Commit**: NO (part of Task 3 group)

---

- [ ] 3c. Create electron-demo React UI components

  **What to do**:

  - Update `App.tsx` to show RPC demo UI
  - Create buttons: Start Worker, Stop Worker
  - Create buttons: Call Worker (add, multiply, getProcessInfo)
  - Create button: Call Main from Worker (triggers worker→main call)
  - Display results in text area
  - Simple two-column layout (optional styling)

  **Must NOT do**:

  - Do NOT add complex styling (basic HTML + minimal CSS)
  - Do NOT add code editor or Monaco
  - Do NOT add multiple pages/routes

  **Recommended Agent Profile**:

  - **Category**: `visual-engineering`
  - **Skills**: `frontend-ui-ux`
  - **Rationale**: Simple UI component work

  **Parallelization**:

  - **Can Run In Parallel**: YES (with Task 3b)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 4
  - **Blocked By**: Task 2

  **References**:

  - `examples/electron-demo/src/App.tsx` - Current app component
  - `examples/tauri-demo/src/routes/+page.svelte` - Similar demo UI pattern

  **Acceptance Criteria**:

  - [ ] UI shows "Electron kkrpc Demo" title
  - [ ] "Start Worker" button spawns utility process
  - [ ] "Stop Worker" button kills worker
  - [ ] "Call Worker: add(2, 3)" shows result
  - [ ] "Call Worker: getProcessInfo()" shows process info
  - [ ] "Trigger Worker→Main Call" shows notification
  - [ ] Results displayed in scrollable text area
  - [ ] Basic error handling (try/catch, error messages shown)

  **Commit**: YES (Task 3 group: "feat(electron-demo): integrate kkrpc with bidirectional RPC")

  - Message: `feat(electron-demo): add kkrpc integration with bidirectional RPC`
  - Files: `examples/electron-demo/worker.ts`, `examples/electron-demo/electron/main.ts`, `examples/electron-demo/src/App.tsx`, `examples/electron-demo/package.json`
  - Pre-commit: `cd examples/electron-demo && npx tsc --noEmit`

---

- [ ] 4. Verification and final testing

  **What to do**:

  - Build kkrpc package
  - Install dependencies in electron-demo
  - Run type checking
  - Test runtime: `npm run dev` and verify all buttons work
  - Document any manual test steps

  **Must NOT do**:

  - Do NOT skip runtime verification
  - Do NOT commit broken code

  **Recommended Agent Profile**:

  - **Category**: `unspecified-low`
  - **Skills**: None
  - **Rationale**: Final verification

  **Parallelization**:

  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4
  - **Blocks**: None (final)
  - **Blocked By**: Task 3b, Task 3c

  **References**:

  - `package.json` scripts for build/test commands

  **Acceptance Criteria**:

  - [ ] `cd packages/kkrpc && bun run build` succeeds
  - [ ] `cd examples/electron-demo && npm install` succeeds
  - [ ] `cd examples/electron-demo && npx tsc --noEmit` passes
  - [ ] `cd examples/electron-demo && npm run dev` starts Electron
  - [ ] All UI buttons work (verified manually or via playwright)
  - [ ] Bidirectional calls complete successfully
  - [ ] Worker cleanup works (no orphaned processes)

  **Evidence to Capture**:

  - [ ] Screenshot of working demo (optional but helpful)
  - [ ] Terminal output showing successful build
  - [ ] Terminal output showing successful type check

  **Commit**: NO (verification only, no code changes expected)

---

## Commit Strategy

| After Task | Message                                                       | Files                                            | Verification       |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------ | ------------------ |
| 1a+1b      | `feat(kkrpc): add Electron utilityProcess adapters`           | adapters/electron.ts, adapters/electron-child.ts | `npx tsc --noEmit` |
| 2          | `feat(kkrpc): add kkrpc/electron entry point`                 | electron.ts, package.json                        | `npx tsc --noEmit` |
| 3a+3b+3c   | `feat(electron-demo): integrate kkrpc with bidirectional RPC` | worker.ts, main.ts, App.tsx, package.json        | `npx tsc --noEmit` |
| 4          | N/A (verification)                                            | N/A                                              | Manual test        |

---

## Success Criteria

### Verification Commands

```bash
# 1. Build kkrpc
cd packages/kkrpc && bun run build
# Expected: Success

# 2. Type check kkrpc
cd packages/kkrpc && npx tsc --noEmit
# Expected: No errors

# 3. Setup demo
cd examples/electron-demo && npm install
# Expected: Success

# 4. Type check demo
cd examples/electron-demo && npx tsc --noEmit
# Expected: No errors

# 5. Run demo (manual verification)
cd examples/electron-demo && npm run dev
# Expected: Electron window opens, all buttons work
```

### Final Checklist

- [ ] ElectronUtilityProcessIO adapter created and tested
- [ ] ElectronParentPortIO adapter created and tested
- [ ] kkrpc/electron entry point working
- [ ] Demo shows bidirectional RPC (main→worker and worker→main)
- [ ] All TypeScript compilation passes
- [ ] Cleanup works (no memory leaks, worker terminates)
- [ ] No orphaned processes after window close

---

## Notes for Executor

### Key Implementation Details

1. **Message Queue Pattern**: Both adapters must use the message queue pattern:

   ```typescript
   private messageQueue: Array<string | IoMessage> = []
   private resolveRead: ((value: string | IoMessage | null) => void) | null = null
   ```

   This allows async read() to wait for messages.

2. **DESTROY_SIGNAL**: Use constant `DESTROY_SIGNAL = "__DESTROY__"` for cleanup.

3. **structuredClone**: Both adapters should declare `structuredClone: true` in capabilities.

4. **Electron Import**: In main process, import from 'electron'. In child process, use global `process.parentPort`.

5. **app.ready**: Worker must be spawned after `app.whenReady()` resolves.

6. **Cleanup**: Always clean up event listeners in destroy() to prevent memory leaks.

### Common Pitfalls to Avoid

- Spawning utilityProcess before app.ready (will fail)
- Forgetting to remove event listeners (memory leak)
- Not using message queue pattern (race conditions)
- Missing structuredClone capability (optimization issue)

### Testing Tips

- Start with simple ping/pong before full API
- Check Electron console for both main and renderer
- Use `console.log` liberally during development
- Verify worker process actually terminates in Activity Monitor/Task Manager
