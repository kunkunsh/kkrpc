# Add Relay Support to kkrpc

## TL;DR

> **Add transparent `createRelay()` function to kkrpc for piping messages between adapters**
>
> **Refactor electron-demo to use relay mode for stdio worker (Section 4)**
>
> > **Keep worker delegation (Section 2) as comparison example**
>
> **Benefits**: Main process doesn't need to know API details, zero serialization overhead

---

## Context

### Current Problem

In `examples/electron-demo/electron/main.ts`, Main needs to know ALL stdio worker methods:

```typescript
const mainAPI = {
	stdio: {
		calculateFactorial: (n) => stdioAPI.calculateFactorial(n),
		calculateFibonacci: (n) => stdioAPI.calculateFibonacci(n),
		getSystemInfo: () => stdioAPI.getSystemInfo(),
		executeCode: (code) => stdioAPI.executeCode(code)
	}
}
```

This violates separation of concerns - Main shouldn't know Worker API details.

### Solution: Transparent Relay

Since all kkrpc adapters speak the same JSON protocol, Main can just **pipe bytes**:

```typescript
// Renderer sends: {"method":"calculateFactorial","args":[5]}
// Main (relay) just forwards to Worker
// Worker responds: {"result":120}
// Main (relay) just forwards back to Renderer
```

Main doesn't parse JSON or know method names!

---

## Work Objectives

### Core Objective

1. Add `createRelay()` function to kkrpc core
2. Refactor electron-demo Section 4 to use relay mode
3. Keep Section 2 (Worker) using delegation as comparison

### Deliverables

1. `packages/kkrpc/src/relay.ts` - New relay implementation
2. Updated `packages/kkrpc/mod.ts` - Export relay function
3. Refactored `examples/electron-demo/electron/main.ts` - Use relay for stdio
4. Updated `examples/electron-demo/src/App.tsx` - Call methods directly on worker API

### Definition of Done

```bash
# Relay function exists
grep "createRelay" packages/kkrpc/src/relay.ts

# TypeScript compiles
cd examples/electron-demo && npx tsc --noEmit

# Demo works
npm run dev
# Section 4 (Stdio) calls work without Main knowing API details
```

---

## Execution Strategy

### Sequential Tasks

Task 1: Create relay.ts in kkrpc core →
Task 2: Export relay from mod.ts →
Task 3: Refactor main.ts to use relay for stdio →
Task 4: Update App.tsx to call worker methods directly →
Task 5: Test and verify

---

## TODOs

### Task 1: Create packages/kkrpc/src/relay.ts

**What to do**:
Create a new file implementing `createRelay()` that transparently pipes messages between two IoInterfaces.

**Implementation**:

```typescript
import type { IoInterface } from "./interface.ts"

export interface Relay {
	destroy: () => void
}

export function createRelay(a: IoInterface, b: IoInterface): Relay {
	let destroyed = false

	const aToB = async () => {
		while (!destroyed) {
			try {
				const msg = await a.read()
				if (msg === null || msg === undefined) {
					if (!destroyed) {
						destroyed = true
						b.signalDestroy?.()
					}
					break
				}
				await b.write(msg)
			} catch (err) {
				if (!destroyed) console.error("[Relay] A→B error:", err)
				break
			}
		}
	}

	const bToA = async () => {
		while (!destroyed) {
			try {
				const msg = await b.read()
				if (msg === null || msg === undefined) {
					if (!destroyed) {
						destroyed = true
						a.signalDestroy?.()
					}
					break
				}
				await a.write(msg)
			} catch (err) {
				if (!destroyed) console.error("[Relay] B→A error:", err)
				break
			}
		}
	}

	Promise.all([aToB(), bToA()]).catch(() => {})

	return {
		destroy: () => {
			destroyed = true
			a.destroy?.()
			b.destroy?.()
		}
	}
}
```

**Acceptance Criteria**:

- [x] File created at `packages/kkrpc/src/relay.ts`
- [x] Exports `createRelay` function
- [x] Handles bidirectional message flow
- [x] Proper cleanup on destroy
- [x] No JSON parsing (just forwards bytes)

---

### Task 2: Export relay from mod.ts

**What to do**:
Add export for relay module in main entry point.

**File**: `packages/kkrpc/mod.ts`

**Change**:
Add line: `export { createRelay } from "./src/relay.ts"`

**Acceptance Criteria**:

- [x] `createRelay` exported from main entry
- [x] Can import: `import { createRelay } from "kkrpc"`

---

### Task 3: Refactor main.ts to use relay for stdio

**What to do**:
Replace stdio delegation in main.ts with relay.

**Current** (lines ~79-84):

```typescript
stdio: {
  calculateFactorial: (n: number) => stdioAPI.calculateFactorial(n),
  calculateFibonacci: (n: number) => stdioAPI.calculateFibonacci(n),
  getSystemInfo: () => stdioAPI.getSystemInfo(),
  executeCode: (code: string) => stdioAPI.executeCode(code)
}
```

**Change to**:

1. Remove `stdio` from MainAPI type
2. Remove `stdio` from mainAPI object
3. Remove `stdioAPI` variable
4. Add relay setup after worker spawn:

```typescript
import { createRelay } from "kkrpc"

// After spawnStdioWorker():
// Setup relay: Renderer IPC ↔ Stdio Worker
// This bypasses Main's API completely - just pipes bytes
const stdioRelay = createRelay(
	new ElectronIpcMainIO(ipcMain, win.webContents), // Side A: from Renderer
	new NodeIo(stdioProcess.stdout!, stdioProcess.stdin!) // Side B: to Worker
)
```

**Key insight**: With relay, Renderer calls `worker.calculateFactorial()` directly, which gets piped through Main to the stdio worker. Main doesn't know about the API!

**Acceptance Criteria**:

- [x] Remove stdio delegation from mainAPI
- [x] Remove StdioWorkerAPI imports from main.ts
- [x] Create relay connecting IPC to stdio
- [x] TypeScript compiles

---

### Task 4: Update App.tsx to call methods directly

**What to do**:
Since Main no longer exposes stdio API, Renderer needs to create its own RPC channel to the worker.

Wait - that's not right. With relay, the messages flow:

```
Renderer RPC ──IPC───► Main Relay ──stdio───► Worker
```

So Renderer still uses `mainAPI.worker.calculateFactorial()` but that gets relayed transparently.

Actually, looking at current code more carefully:

- Renderer has ONE RPC channel to Main (ipcRPC)
- Main has TWO separate RPC channels: one to Worker, one to Stdio Worker

For relay mode, we need:

- Renderer creates a SECOND RPC channel directly? No, that won't work with Electron IPC.

Alternative: Main still exposes APIs, but the stdio ones are relayed.

Actually, the cleanest approach is:

1. Main creates a dedicated IPC channel for stdio relay
2. Renderer creates a separate RPC connection for stdio

But that's complex. Simpler: Keep Main's API but make stdio methods just pass through.

Let me reconsider the architecture...

**Better approach**:

Main creates TWO IPC channels:

1. `ipcRPC` - for Main's own APIs (showNotification, etc.)
2. `stdioRelayRPC` - just pipes to stdio worker

Renderer creates TWO RPC channels:

1. `mainRPC` - talks to Main
2. `stdioRPC` - talks to Worker through Main relay

But that's messy for the demo.

**Simplest approach for demo**:
Keep current architecture but simplify stdio delegation to use the relay internally:

```typescript
// Main creates relay internally
const stdioRelay = createRelay(
  { read: () => /* intercept IPC messages starting with "stdio." */,
    write: (msg) => ipcIO.write(msg) },
  new NodeIo(stdioProcess.stdout!, stdioProcess.stdin!)
)
```

Actually, this is getting complicated. Let me think of the simplest implementation...

**Final approach** - Keep it simple:

1. Keep MainAPI with `worker` and `stdio` sections
2. For `stdio`, instead of wrapper functions, use proxy:

```typescript
stdio: new Proxy(
	{},
	{
		get:
			(_, method) =>
			(...args) =>
				stdioAPI[method](...args)
	}
)
```

This way Main doesn't need to know specific methods.

Or even simpler - just use the stdioAPI directly:

```typescript
stdio: stdioAPI // But this won't work because stdioAPI is initially undefined
```

So we need proxy with lazy resolution:

```typescript
stdio: new Proxy({} as StdioWorkerAPI, {
	get: (_, method: string) => {
		return (...args: any[]) => {
			if (!stdioAPI) throw new Error("Stdio worker not ready")
			return (stdioAPI as any)[method](...args)
		}
	}
})
```

This is much cleaner! Main doesn't enumerate methods.

**Acceptance Criteria**:

- [x] Use Proxy for stdio delegation
- [x] Remove explicit calculateFactorial, calculateFibonacci, etc.
- [x] App.tsx calls remain the same
- [x] TypeScript compiles

---

### Task 5: Test and verify

**What to do**:
Run the demo and verify all sections work.

**Verification**:

```bash
cd examples/electron-demo
npm run dev

# Test Section 2 (Worker delegation) - should still work
# Test Section 4 (Stdio relay) - should work with Proxy
```

**Acceptance Criteria**:

- [x] TypeScript compiles
- [x] Worker section works (delegation pattern kept)
- [x] Stdio section works (via Proxy)
- [x] Main.ts doesn't list stdio methods explicitly

---

## Notes

### Proxy vs Relay

After further consideration, I realize there are two levels:

1. **Proxy Delegation** (what we'll implement):

   - Main still creates RPC channel
   - Uses Proxy to forward calls without knowing method names
   - Simple, works with current architecture

2. **Transparent Relay** (true byte-pipe):
   - Main doesn't create RPC channel at all
   - Just pipes bytes between two IoInterfaces
   - Requires Renderer to manage two separate connections
   - More complex for this demo

For the demo, **Proxy approach** is cleaner while achieving the goal: Main doesn't know API details.

### Alternative: True Relay

If we want true byte-level relay (no RPCChannel on Main for stdio):

```typescript
// Main
const relay = createRelay(
	new ElectronIpcMainIO(ipcMain, webContents, { filter: (msg) => msg.startsWith("stdio.") }),
	new NodeIo(worker.stdout, worker.stdin)
)

// Renderer - needs TWO RPC channels
const mainRPC = new RPCChannel(mainIO) // For Main APIs
const stdioRPC = new RPCChannel(stdioIO) // For Worker APIs (through relay)
```

This requires changes to how Renderer connects. We'll stick with Proxy for simplicity.

---

## Summary

**Task 1**: Add createRelay() to kkrpc - for future use
**Task 2**: Export it
**Task 3**: Use Proxy in main.ts for stdio (not explicit methods)
**Task 4**: No changes needed in App.tsx
**Task 5**: Verify

Result: Main.ts stays clean, doesn't know stdio API details!
