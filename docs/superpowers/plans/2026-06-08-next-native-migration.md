# Next Native Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-friendly native-vNext migration guidance, a migration-only classic IO bridge, and next-first skill instructions without converting repo tests/examples through compatibility shims.

**Architecture:** `kkrpc/next` remains the small native core. `kkrpc/next/io` is a separate optional bridge from classic `IoInterface` to `Transport<RPCMessage>` for user migration only. Repo tests/examples use native vNext transports when available; blocked adapters stay classic until native transports are added in later slices.

**Tech Stack:** TypeScript, Bun test runner, tsdown package entries, Agent Skills markdown.

---

### Task 1: Add The Migration Guide

**Files:**
- Create: `packages/kkrpc/NEXT_MIGRATION.md`
- Reference: `docs/superpowers/specs/2026-06-08-next-native-migration-design.md`

- [ ] **Step 1: Write the migration guide**

Create `packages/kkrpc/NEXT_MIGRATION.md` with this content:

```markdown
# kkrpc/next Migration Guide

`kkrpc/next` is the preferred path for new vNext examples and tests. Use native vNext APIs when a native vNext transport exists. Use compatibility helpers only for existing user code that needs an incremental migration.

## Decision Table

| Current code | Migration action |
| --- | --- |
| In-memory, Worker, or stdio transport | Migrate to native `kkrpc/next` now |
| Validation or middleware options | Use native plugins from `kkrpc/next/validation` or `kkrpc/next/middleware` |
| SuperJSON serialization | Use a native codec from `kkrpc/next/superjson` |
| Existing classic `validators` or `interceptors` options | Use `kkrpc/next/classic-compat` temporarily |
| Existing user-owned classic `IoInterface` adapter with no native next transport | Use `kkrpc/next/io` temporarily |
| Repo test/example for a classic-only adapter | Keep it classic or add a native vNext transport first |

## Native vNext Patterns

Use `wrap()` when the local side only calls a remote API:

```ts
import { wrap } from "kkrpc/next"

const api = wrap<RemoteAPI>(transport)
await api.ping()
```

Use `expose()` when the local side only exposes an API:

```ts
import { expose } from "kkrpc/next"

const controller = expose(localAPI, transport)
controller.dispose()
```

Use `RPCChannel` when both sides expose APIs or when the caller needs explicit channel ownership:

```ts
import { RPCChannel } from "kkrpc/next"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { expose: localAPI })
const remote = channel.getAPI()
```

## AI Migration Checklist

1. Identify the current entry point and transport.
2. Check whether a native vNext transport exists for that transport family.
3. If native exists, migrate to `wrap()`, `expose()`, or `RPCChannel` from `kkrpc/next`.
4. If native does not exist, do not rewrite repo examples/tests through a bridge just to make them look like vNext.
5. Use `classic-compat` only for old option names such as `validators` and `interceptors`.
6. Use `next/io` only for user-owned classic `IoInterface` adapters during migration.
7. Run the smallest focused test for the migrated file, then run `pnpm --filter kkrpc check-types`.

## Native Transport Availability

Native vNext transports currently available:

- Worker: `kkrpc/next/worker`
- stdio: `kkrpc/next/stdio`
- custom platforms/codecs: `kkrpc/next/transport` and `kkrpc/next/codecs`

Classic-only transport families should remain classic until a native vNext transport is added:

- HTTP and framework HTTP helpers
- WebSocket, Hono WebSocket, Elysia WebSocket, and Socket.IO
- iframe, Chrome extension, Electron, and Tauri adapters
- RabbitMQ, Redis Streams, Kafka, and NATS

## Compatibility Helpers

`kkrpc/next/classic-compat` translates classic-style options into native plugins:

```ts
import { wrapCompat } from "kkrpc/next/classic-compat"

const api = wrapCompat<RemoteAPI>(transport, {
	validators,
	interceptors
})
```

`kkrpc/next/io` adapts an existing classic `IoInterface` instance into a vNext transport:

```ts
import { RPCChannel } from "kkrpc/next"
import { ioTransport } from "kkrpc/next/io"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(ioTransport(classicIo), {
	expose: localAPI
})
```

Do not use either helper as the default pattern in new repo examples. Prefer native transports or keep the example classic until native transport support exists.
```

- [ ] **Step 2: Inspect the guide for migration-rule clarity**

Run: `grep -n "classic-compat\|next/io\|native" packages/kkrpc/NEXT_MIGRATION.md`

Expected: Output includes explicit rules that `classic-compat` and `next/io` are temporary migration helpers, not default new-example paths.

### Task 2: Write The Failing Bridge Test

**Files:**
- Create: `packages/kkrpc/__tests__/next-io.test.ts`
- Later modify: `packages/kkrpc/src/next/io.ts`
- Later create: `packages/kkrpc/next-io.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/kkrpc/__tests__/next-io.test.ts` with this content:

```ts
import { describe, expect, test } from "bun:test"

import { expose, wrap, type RPCMessage } from "../next.ts"
import { ioTransport } from "../next-io.ts"
import type { IoCapabilities, IoInterface, IoMessage } from "../src/interface.ts"
import type { WireEnvelope } from "../src/serialization.ts"

interface API {
	add(a: number, b: number): Promise<number>
	ping(): Promise<string>
}

class TestIO implements IoInterface {
	name: string
	capabilities?: IoCapabilities
	peer?: TestIO
	signalDestroyCount = 0
	destroyCount = 0
	writes: Array<string | IoMessage> = []
	private queue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null

	constructor(name: string, capabilities?: IoCapabilities) {
		this.name = name
		this.capabilities = capabilities
	}

	pushIncoming(message: string | IoMessage): void {
		if (this.resolveRead) {
			const resolve = this.resolveRead
			this.resolveRead = null
			resolve(message)
			return
		}
		this.queue.push(message)
	}

	read(): Promise<string | IoMessage | null> {
		if (this.queue.length > 0) return Promise.resolve(this.queue.shift() ?? null)
		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	write(message: string | IoMessage): Promise<void> {
		this.writes.push(message)
		queueMicrotask(() => this.peer?.pushIncoming(message))
		return Promise.resolve()
	}

	on(): void {}
	off(): void {}

	destroy(): void {
		this.destroyCount++
		if (this.resolveRead) {
			const resolve = this.resolveRead
			this.resolveRead = null
			resolve(null)
		}
	}

	signalDestroy(): void {
		this.signalDestroyCount++
	}
}

function createPair(capabilities?: IoCapabilities) {
	const client = new TestIO("client", capabilities)
	const server = new TestIO("server", capabilities)
	client.peer = server
	server.peer = client
	return { client, server }
}

describe("kkrpc/next io bridge", () => {
	test("adapts classic string IoInterface instances into next transports", async () => {
		const { client, server } = createPair()
		const controller = expose({ add: async (a: number, b: number) => a + b }, ioTransport(server))
		const api = wrap<API>(ioTransport(client))

		try {
			expect(await api.add(2, 3)).toBe(5)
		} finally {
			controller.dispose()
		}
	})

	test("copies broadcast capability and disables transfer", () => {
		const transport = ioTransport(new TestIO("broadcast", { broadcast: true, transfer: true }))

		expect(transport.capabilities).toEqual({ objectMode: false, transfer: false, broadcast: true })
	})

	test("does not deliver messages after unsubscribe", async () => {
		const io = new TestIO("single")
		const transport = ioTransport(io)
		const received: RPCMessage[] = []
		const unsubscribe = transport.subscribe((message) => received.push(message))

		io.pushIncoming(JSON.stringify({ t: "r", id: "1", v: "first" }))
		await new Promise((resolve) => setTimeout(resolve, 0))
		unsubscribe()
		io.pushIncoming(JSON.stringify({ t: "r", id: "2", v: "second" }))
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(received).toEqual([{ t: "r", id: "1", v: "first" }])
	})

	test("reports unsupported object-mode IoMessage values", async () => {
		const io = new TestIO("structured")
		const errors: Error[] = []
		const transport = ioTransport(io, { onError: (error) => errors.push(error) })
		transport.subscribe(() => {})
		const envelope: WireEnvelope = {
			version: 2,
			encoding: "object",
			payload: { type: "request", id: "1", method: "ping", args: [], callbackIds: [] }
		}

		io.pushIncoming({ data: envelope })
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(errors).toHaveLength(1)
		expect(errors[0].message).toContain("only supports string")
	})

	test("close defaults to signalDestroy then destroy", () => {
		const io = new TestIO("closable")
		const transport = ioTransport(io)

		transport.close?.()

		expect(io.signalDestroyCount).toBe(1)
		expect(io.destroyCount).toBe(1)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/kkrpc`: `bun test __tests__/next-io.test.ts`

Expected: FAIL because `../next-io.ts` does not exist.

### Task 3: Implement The Bridge

**Files:**
- Create: `packages/kkrpc/src/next/io.ts`
- Create: `packages/kkrpc/next-io.ts`
- Test: `packages/kkrpc/__tests__/next-io.test.ts`

- [ ] **Step 1: Add the bridge implementation**

Create `packages/kkrpc/src/next/io.ts` with this content:

```ts
/**
 * Migration bridge from classic IoInterface adapters to kkrpc/next transports.
 *
 * This module is intentionally separate from `kkrpc/next`: it is for existing
 * user-owned classic IO adapters, not the native transport path for new code.
 */

import type { IoInterface, IoMessage } from "../interface.ts"
import { jsonCodec } from "./codecs.ts"
import type { RPCMessage } from "./protocol.ts"
import type { Transport } from "./transport.ts"

export interface IoTransportOptions {
	closeMode?: "signal-and-destroy" | "signal" | "destroy" | "none"
	onError?: (error: Error) => void
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}

function reportError(error: unknown, onError: ((error: Error) => void) | undefined): void {
	const normalized = toError(error)
	if (onError) {
		onError(normalized)
		return
	}
	queueMicrotask(() => {
		throw normalized
	})
}

function extractString(raw: string | IoMessage): string {
	if (typeof raw === "string") return raw
	if (typeof raw.data === "string") return raw.data
	throw new Error("kkrpc/next/io only supports string IoInterface messages")
}

/** Adapt a classic IoInterface into a JSON-string kkrpc/next transport. */
export function ioTransport(io: IoInterface, options: IoTransportOptions = {}): Transport<RPCMessage> {
	const codec = jsonCodec<RPCMessage>()
	const listeners = new Set<(message: RPCMessage) => void>()
	let closed = false
	let reading = false

	const startReading = () => {
		if (reading) return
		reading = true
		void (async () => {
			while (!closed) {
				try {
					const raw = await io.read()
					if (raw === null) break
					const wire = extractString(raw)
					if (wire.trim().length === 0) continue
					const message = codec.decode(wire)
					for (const listener of listeners) listener(message)
				} catch (error) {
					reportError(error, options.onError)
					break
				}
			}
			closed = true
		})()
	}

	return {
		capabilities: {
			objectMode: false,
			transfer: false,
			broadcast: io.capabilities?.broadcast
		},
		send(message) {
			return io.write(codec.encode(message))
		},
		subscribe(listener) {
			if (closed) return () => {}
			listeners.add(listener)
			startReading()
			return () => {
				listeners.delete(listener)
			}
		},
		close() {
			if (closed) return
			closed = true
			const closeMode = options.closeMode ?? "signal-and-destroy"
			if (closeMode === "signal" || closeMode === "signal-and-destroy") io.signalDestroy?.()
			if (closeMode === "destroy" || closeMode === "signal-and-destroy") io.destroy?.()
		}
	}
}
```

- [ ] **Step 2: Add the public entry re-export**

Create `packages/kkrpc/next-io.ts` with this content:

```ts
/**
 * Optional migration bridge from classic IoInterface adapters to kkrpc/next.
 *
 * Prefer native vNext transports for new code. Use this entry only when
 * incrementally migrating an existing classic adapter instance.
 */

export * from "./src/next/io.ts"
```

- [ ] **Step 3: Run test to verify it passes**

Run from `packages/kkrpc`: `bun test __tests__/next-io.test.ts`

Expected: PASS, all `next-io` tests green.

### Task 4: Add Package Export And Build Entry

**Files:**
- Modify: `packages/kkrpc/package.json`
- Modify: `packages/kkrpc/tsdown.config.ts`
- Test: `packages/kkrpc/__tests__/next-io.test.ts`

- [ ] **Step 1: Add the package export**

In `packages/kkrpc/package.json`, insert this block after `./next/stdio` and before `./next/transport`:

```json
"./next/io": {
	"import": {
		"types": "./dist/next-io.d.ts",
		"default": "./dist/next-io.js"
	},
	"require": {
		"types": "./dist/next-io.d.cts",
		"default": "./dist/next-io.cjs"
	}
},
```

- [ ] **Step 2: Add the tsdown entry**

In `packages/kkrpc/tsdown.config.ts`, insert this entry after `"./next-stdio.ts"`:

```ts
"./next-io.ts",
```

- [ ] **Step 3: Run focused test**

Run from `packages/kkrpc`: `bun test __tests__/next-io.test.ts`

Expected: PASS.

### Task 5: Update Architecture Documentation

**Files:**
- Modify: `packages/kkrpc/NEXT_ARCHITECTURE.md`
- Reference: `packages/kkrpc/NEXT_MIGRATION.md`

- [ ] **Step 1: Replace the migration-limit paragraph**

In `packages/kkrpc/NEXT_ARCHITECTURE.md`, replace the paragraph that starts with `It does not convert old IoInterface adapters` with:

```markdown
Classic compatibility does not make classic adapters native vNext transports. `kkrpc/next/io` is a separate migration bridge that adapts an existing `IoInterface` to `Transport<RPCMessage>` over JSON strings. Use it for existing user code that needs an incremental path to vNext.

Repo tests and examples should not use `kkrpc/next/io` as a fake native transport. If a transport family does not yet have a native vNext implementation, keep that example classic or add a native transport in a dedicated slice.
```

- [ ] **Step 2: Update remaining migration work**

In the `Remaining Migration Work` list, replace the migration-guide bullet with:

```markdown
- Native vNext transport implementations for RabbitMQ, Redis Streams, NATS, Kafka, HTTP, WebSocket, framework adapters, iframe, Chrome extension, Electron, and Tauri.
- Incremental migration of examples/tests only after each transport family has a native vNext transport.
```

### Task 6: Update The kkrpc Skill With A Pressure Scenario First

**Files:**
- Modify: `skills/kkrpc/SKILL.md`
- Reference: `skills/AGENTS.md`

- [ ] **Step 1: Run the baseline pressure scenario before editing the skill**

Dispatch a research-only subagent with this prompt:

```text
You are helping migrate kkrpc repo examples to kkrpc/next. You have old examples using classic RPCChannel and classic adapters. kkrpc/next has wrap/expose/RPCChannel, worker and stdio native transports, classic-compat, and an optional next/io bridge. Decide how you would migrate examples/tests for Worker, stdio, HTTP/WebSocket, and RabbitMQ. Return only your migration rules and example choices. Do not edit files.
```

Expected baseline failure to watch for: the subagent recommends `classic-compat` or `next/io` as the default way to rewrite repo examples for adapters that lack native transports.

- [ ] **Step 2: Update the skill frontmatter description**

Change `skills/kkrpc/SKILL.md` line 3 to include vNext triggers while keeping classic adapter triggers:

```yaml
description: Build bidirectional RPC systems in TypeScript with kkrpc. Use this skill when wiring kkrpc/next wrap/expose/RPCChannel, choosing native next transports, migrating classic RPCChannel code, integrating adapters, transferables, middleware, validation, or inspector tooling.
```

- [ ] **Step 3: Replace the central pattern introduction**

Replace lines 25-35 with:

```markdown
Use kkrpc to expose a local TypeScript object and call the remote side as a typed proxy.

For new code and migrated repo examples, prefer the native vNext API:

```typescript
import { expose, wrap } from "kkrpc/next"

const controller = expose(localAPI, serverTransport)
const remote = wrap<RemoteAPI>(clientTransport)
```

Use low-level `RPCChannel` when both sides expose APIs or when you need explicit channel ownership:

```typescript
import { RPCChannel } from "kkrpc/next"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { expose: localAPI })
const remote = channel.getAPI()
```

The stable classic API remains available for existing adapter integrations:

```typescript
import { RPCChannel } from "kkrpc"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(io, { expose: localAPI })
const remote = channel.getAPI()
```
```

- [ ] **Step 4: Add a next-first decision section after `First Decisions`**

Insert this section after the `First Decisions` list:

```markdown
## Next-First Migration Rules

| Situation | Use |
| --- | --- |
| New code or repo examples with native Worker/stdio/custom transport | `kkrpc/next` native API |
| Bidirectional vNext APIs | `RPCChannel` from `kkrpc/next` |
| Existing classic code with `validators` or `interceptors` options | `kkrpc/next/classic-compat` temporarily |
| Existing user-owned classic `IoInterface` adapter with no native next transport | `kkrpc/next/io` temporarily |
| Repo tests/examples for classic-only adapters | Keep classic or add a native vNext transport first |

Do not use `classic-compat` or `next/io` as the default path for new repo examples. They are migration helpers, not native vNext transports.
```

- [ ] **Step 5: Add next entries to the entry point table**

Add these rows near the top of the `Entry Points` table:

```markdown
| Native vNext core | `kkrpc/next` | Preferred for new code: `wrap`, `expose`, `RPCChannel` |
| Native vNext Worker | `kkrpc/next/worker` | Native Worker transports |
| Native vNext stdio | `kkrpc/next/stdio` | Native JSON-line stdio transports |
| Native vNext codecs/transports | `kkrpc/next/codecs`, `kkrpc/next/transport` | Custom native transports |
| vNext migration helpers | `kkrpc/next/classic-compat`, `kkrpc/next/io` | Temporary migration only |
```

- [ ] **Step 6: Verify the updated skill blocks the bad migration path**

Re-run the pressure scenario with the updated skill instructions in the prompt. Expected: the agent chooses native Worker/stdio migration, leaves HTTP/WebSocket/RabbitMQ classic until native transports exist, and uses `classic-compat`/`next/io` only for user migration.

### Task 7: Final Verification

**Files:**
- All modified files in this plan

- [ ] **Step 1: Run focused tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-io.test.ts __tests__/next-core.test.ts __tests__/next-worker.test.ts __tests__/next-stdio.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run type check**

Run from repo root:

```bash
pnpm --filter kkrpc check-types
```

Expected: TypeScript exits successfully.

- [ ] **Step 3: Run build because package exports changed**

Run from repo root:

```bash
pnpm --filter kkrpc build
```

Expected: build completes. Typedoc warnings may appear if they already exist, but there should be no build failure.

- [ ] **Step 4: Inspect diff**

Run from repo root:

```bash
git diff -- packages/kkrpc/NEXT_MIGRATION.md packages/kkrpc/src/next/io.ts packages/kkrpc/next-io.ts packages/kkrpc/__tests__/next-io.test.ts packages/kkrpc/package.json packages/kkrpc/tsdown.config.ts packages/kkrpc/NEXT_ARCHITECTURE.md skills/kkrpc/SKILL.md docs/superpowers/specs/2026-06-08-next-native-migration-design.md docs/superpowers/plans/2026-06-08-next-native-migration.md
```

Expected: diff only contains the intended migration guide, bridge, tests, export/build wiring, architecture note, skill update, spec, and plan.

- [ ] **Step 5: Commit only if explicitly requested**

If the user requests a commit, inspect status and recent commits first:

```bash
git status --short
git diff --stat
git log --oneline -10
```

Then stage only intended files and commit with:

```bash
git add packages/kkrpc/NEXT_MIGRATION.md packages/kkrpc/src/next/io.ts packages/kkrpc/next-io.ts packages/kkrpc/__tests__/next-io.test.ts packages/kkrpc/package.json packages/kkrpc/tsdown.config.ts packages/kkrpc/NEXT_ARCHITECTURE.md skills/kkrpc/SKILL.md docs/superpowers/specs/2026-06-08-next-native-migration-design.md docs/superpowers/plans/2026-06-08-next-native-migration.md
git commit -m "feat(kkrpc): add next migration bridge guidance"
```
