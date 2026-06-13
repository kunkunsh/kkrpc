# Remote References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add protocol-level remote references so functions nested in RPC values and explicitly proxied objects can cross kkrpc transports safely, return values/errors propagate, and examples demonstrate the feature across a Worker boundary.

**Architecture:** Add a small remote-reference helper module for public APIs and metadata, extend the compact protocol with `op: "ref"`, and refactor `RPCChannel` value encode/decode into a recursive copy-on-write transformer. Keep by-value data as data, use `proxy(value)` only for explicit object refs, and make cleanup deterministic through `releaseProxy()` and `channel.destroy()`.

**Tech Stack:** TypeScript, Bun tests, pnpm workspace, kkrpc compact protocol, Worker transport, existing plugin/transport abstractions.

---

## File Structure

- Create `packages/kkrpc/src/core/remote-ref.ts`: public helpers (`proxy`, `releaseProxy`, `isRemoteProxy`), envelope guards, marker WeakSets/WeakMaps, and exported error classes.
- Modify `packages/kkrpc/src/core/protocol.ts`: add `"ref"` to `RPCOperation`; keep `RPCCallback` in the active `RPCMessage` union until Task 2 replaces legacy callback emission.
- Modify `packages/kkrpc/src/core/transport.ts`: add `remoteRefs?: boolean` to `TransportCapabilities`; concrete bidirectional transports advertise support in Task 4.
- Modify `packages/kkrpc/src/core/channel.ts`: replace callback registry with generic ref registries, add recursive encode/decode, handle `op: "ref"` before exposed-API dispatch, add release/rollback/destroy behavior.
- Modify `packages/kkrpc/src/core/index.ts` and entries through re-export: export remote-ref helpers and errors from the main package.
- Modify bidirectional transports under `packages/kkrpc/src/transports/`: set `remoteRefs: true` for bidirectional transports and `remoteRefs: false` for HTTP request-scoped transports.
- Modify `packages/kkrpc/src/transports/http.ts`: reject `__kkrpc_ref__`, stream refs, and legacy callback envelopes through one recursive unsupported-envelope walker.
- Create `packages/kkrpc/__tests__/remote-refs.test.ts`: comprehensive unit/integration tests for function refs, object refs, cleanup, rollback, validation, streams, errors, and `$ref` user-path safety.
- Modify `packages/kkrpc/__tests__/worker.test.ts`: add real Worker structured-clone remote-ref regression.
- Modify `packages/kkrpc/__tests__/http.test.ts`: add HTTP remote-ref rejection/no-leak regression.
- Modify `packages/kkrpc/__tests__/validation.test.ts`: add validation behavior for function args and `op: "ref"` skip.
- Create `examples/remote-references-demo/`: self-contained demo with Worker transport, returned function leaves, callback return values, explicit object proxy, and `releaseProxy()`.
- Modify docs site under `docs/src/content/docs/`: document remote references, cleanup APIs, transport support, and link to the new example.

---

### Task 1: Protocol, Public Helpers, and Transport Capability

**Files:**

- Create: `packages/kkrpc/src/core/remote-ref.ts`
- Modify: `packages/kkrpc/src/core/protocol.ts`
- Modify: `packages/kkrpc/src/core/transport.ts`
- Modify: `packages/kkrpc/src/core/index.ts`
- Test: `packages/kkrpc/__tests__/remote-refs.test.ts`

- [ ] **Step 1: Write failing public-helper and protocol tests**

Create `packages/kkrpc/__tests__/remote-refs.test.ts` with the initial helper/protocol tests and a reusable memory transport:

```ts
import { describe, expect, test } from "bun:test"
import {
	isRemoteProxy,
	proxy,
	releaseProxy,
	RPCChannel,
	type RPCMessage,
	type Transport
} from "../src/entries/mod.ts"

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true, remoteRefs: true }
	closed = false
	peer?: MemoryTransport
	postError?: Error
	messages: RPCMessage[] = []
	transfers: Transferable[][] = []
	private listeners = new Set<(message: RPCMessage) => void>()

	send(message: RPCMessage, transfers: Transferable[] = []): void {
		if (this.postError) throw this.postError
		this.messages.push(message)
		this.transfers.push(transfers)
		queueMicrotask(() => {
			for (const listener of this.peer?.listeners ?? []) listener(message)
		})
	}

	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	close(): void {
		this.closed = true
	}
}

function createPair(): [MemoryTransport, MemoryTransport] {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return [a, b]
}

describe("remote references", () => {
	test("proxy marks objects and releaseProxy is a no-op for non-proxies", async () => {
		const target = { value: 1 }
		expect(proxy(target)).toBe(target)
		expect(isRemoteProxy(target)).toBe(false)
		await expect(releaseProxy({ not: "remote" })).resolves.toBeUndefined()
	})

	test("normal user APIs may expose a top-level $ref property", async () => {
		const [clientTransport, serverTransport] = createPair()
		const client = new RPCChannel<object, { $ref: { ping(): Promise<string> } }>(clientTransport)
		const server = new RPCChannel<{ $ref: { ping(): string } }, object>(serverTransport, {
			expose: { $ref: { ping: () => "user-path-ok" } }
		})

		expect(await client.getAPI().$ref.ping()).toBe("user-path-ok")

		client.destroy()
		server.destroy()
	})
})
```

- [ ] **Step 2: Run tests to verify initial failure**

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "proxy marks objects"`

Expected: FAIL because `proxy`, `releaseProxy`, and `isRemoteProxy` are not exported yet, or because `TransportCapabilities.remoteRefs` is not typed.

- [ ] **Step 3: Add `remote-ref.ts` helper module**

Create `packages/kkrpc/src/core/remote-ref.ts`:

```ts
export const REMOTE_REF_TAG = "__kkrpc_ref__" as const

export type RemoteRefKind = "function" | "object"

export interface RemoteRefEnvelope {
	readonly [REMOTE_REF_TAG]: true
	readonly id: string
	readonly kind: RemoteRefKind
}

export interface RemoteProxyRecord {
	id: string
	kind: RemoteRefKind
	released: boolean
	release(): Promise<void>
	markReleased(): void
}

export class RPCEncodeError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "RPCEncodeError"
	}
}

export class RPCRemoteReferenceReleasedError extends Error {
	constructor(refId: string) {
		super(`RPC remote reference ${refId} has been released`)
		this.name = "RPCRemoteReferenceReleasedError"
	}
}

const explicitProxyTargets = new WeakSet<object>()
const remoteProxyRegistry = new WeakMap<object, RemoteProxyRecord>()

export function proxy<T extends object>(value: T): T {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) {
		throw new TypeError("proxy() requires an object or function value")
	}
	explicitProxyTargets.add(value)
	return value
}

export function isExplicitProxyTarget(value: unknown): value is object {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		explicitProxyTargets.has(value)
	)
}

export function registerRemoteProxy(value: object, record: RemoteProxyRecord): void {
	remoteProxyRegistry.set(value, record)
}

export function getRemoteProxyRecord(value: unknown): RemoteProxyRecord | undefined {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined
	return remoteProxyRegistry.get(value)
}

export function isRemoteProxy(value: unknown): boolean {
	return getRemoteProxyRecord(value) !== undefined
}

export async function releaseProxy(value: unknown): Promise<void> {
	const record = getRemoteProxyRecord(value)
	if (!record || record.released) return
	record.markReleased()
	await record.release()
}

export function isRemoteRefEnvelope(value: unknown): value is RemoteRefEnvelope {
	if (typeof value !== "object" || value === null) return false
	const record = value as Partial<RemoteRefEnvelope>
	return (
		record[REMOTE_REF_TAG] === true &&
		typeof record.id === "string" &&
		(record.kind === "function" || record.kind === "object")
	)
}
```

- [ ] **Step 4: Extend protocol and exports**

Modify `packages/kkrpc/src/core/protocol.ts`:

```ts
export type RPCOperation = "call" | "get" | "set" | "new" | "ref"
```

Keep `RPCCallback` in the active `RPCMessage` union for Task 1 because legacy callback emission still uses `t: "cb"` until Task 2 replaces it:

```ts
export interface RPCCallback {
	t: "cb"
	id: string
	a: unknown[]
}

export type RPCMessage =
	| RPCRequest
	| RPCResponse
	| RPCCallback
	| RPCStreamRequest
	| RPCStreamResponse
```

Task 2 removes `RPCCallback` from the active protocol after function refs replace legacy callback emission.

Modify `packages/kkrpc/src/core/index.ts`:

```ts
export {
	proxy,
	releaseProxy,
	isRemoteProxy,
	RPCEncodeError,
	RPCRemoteReferenceReleasedError
} from "./remote-ref.ts"
export type { RemoteRefEnvelope, RemoteRefKind } from "./remote-ref.ts"
```

- [ ] **Step 5: Extend transport capabilities**

Modify `packages/kkrpc/src/core/transport.ts`:

```ts
export interface TransportCapabilities {
	objectMode?: boolean
	transfer?: boolean
	broadcast?: boolean
	remoteRefs?: boolean
}
```

Do not set `remoteRefs: true` in generic `createTransport()`; Task 4 adds explicit capabilities to concrete bidirectional transports:

```ts
capabilities: {
	objectMode: platform.capabilities?.objectMode,
	transfer: supportsTransfer
}
```

- [ ] **Step 6: Run helper/protocol tests**

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "proxy marks objects"`

Expected: PASS for the helper test.

Run: `pnpm --filter kkrpc check-types`

Expected: PASS after `RPC_OPERATIONS` includes `"ref"` and `RPCCallback` remains exported for legacy callback emission.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/kkrpc/src/core/remote-ref.ts packages/kkrpc/src/core/protocol.ts packages/kkrpc/src/core/transport.ts packages/kkrpc/src/core/index.ts packages/kkrpc/__tests__/remote-refs.test.ts
git commit -m "feat: add remote reference protocol helpers"
```

---

### Task 2: Function Remote References Through `op: "ref"`

**Files:**

- Modify: `packages/kkrpc/src/core/channel.ts`
- Modify: `packages/kkrpc/__tests__/remote-refs.test.ts`

- [ ] **Step 1: Add failing function-ref tests**

Append these tests inside the existing `describe("remote references", ...)` block in `packages/kkrpc/__tests__/remote-refs.test.ts`:

```ts
test("nested returned function can be called and return a value", async () => {
	const [clientTransport, serverTransport] = createPair()
	const client = new RPCChannel<
		object,
		{ createToast(message: string): Promise<{ hide(): Promise<string> }> }
	>(clientTransport)
	const server = new RPCChannel<
		{ createToast(message: string): { hide(): Promise<string> } },
		object
	>(serverTransport, {
		expose: {
			createToast(message) {
				return { hide: async () => `hidden:${message}` }
			}
		}
	})

	const toast = await client.getAPI().createToast("hello")
	expect(await toast.hide()).toBe("hidden:hello")

	client.destroy()
	server.destroy()
})

test("function argument can return a value and throw an error", async () => {
	const [clientTransport, serverTransport] = createPair()
	const client = new RPCChannel<
		object,
		{
			callCallback(callback: (value: string) => Promise<string>): Promise<string>
			failCallback(callback: () => Promise<void>): Promise<void>
		}
	>(clientTransport)
	const server = new RPCChannel<
		{
			callCallback(callback: (value: string) => Promise<string>): Promise<string>
			failCallback(callback: () => Promise<void>): Promise<void>
		},
		object
	>(serverTransport, {
		expose: {
			async callCallback(callback) {
				return await callback("from-server")
			},
			async failCallback(callback) {
				await callback()
			}
		}
	})

	expect(await client.getAPI().callCallback(async (value) => `client:${value}`)).toBe(
		"client:from-server"
	)
	await expect(
		client.getAPI().failCallback(async () => {
			throw new Error("callback boom")
		})
	).rejects.toThrow("callback boom")

	client.destroy()
	server.destroy()
})

test("callback from wrap-style client does not require exposed API", async () => {
	const [clientTransport, serverTransport] = createPair()
	const client = new RPCChannel<
		object,
		{ useClientCallback(callback: () => Promise<string>): Promise<string> }
	>(clientTransport)
	const server = new RPCChannel<
		{ useClientCallback(callback: () => Promise<string>): Promise<string> },
		object
	>(serverTransport, {
		expose: {
			async useClientCallback(callback) {
				return await callback()
			}
		}
	})

	expect(await client.getAPI().useClientCallback(async () => "client-only-ok")).toBe(
		"client-only-ok"
	)

	client.destroy()
	server.destroy()
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "nested returned function"`

Expected: FAIL with an uncloneable function, missing remote-ref decode, or timeout.

- [ ] **Step 3: Add local ref state and helpers to `RPCChannel`**

Modify imports at the top of `packages/kkrpc/src/core/channel.ts`:

```ts
import {
	getRemoteProxyRecord,
	isExplicitProxyTarget,
	isRemoteRefEnvelope,
	registerRemoteProxy,
	RPCEncodeError,
	RPCRemoteReferenceReleasedError,
	type RemoteRefEnvelope,
	type RemoteRefKind
} from "./remote-ref.ts"
```

Replace the callback map field with generic ref fields:

```ts
type RefRecord = {
	id: string
	kind: RemoteRefKind
	target: unknown
	createdAt: number
	lastUsedAt: number
	createdBy?: string
	released: boolean
	explicit: boolean
}

type EncodeSession = {
	transfers: Transferable[]
	createdRefIds: string[]
	seen: WeakSet<object>
	path: string
}
```

Add fields inside `RPCChannel`:

```ts
private localRefs = new Map<string, RefRecord>()
private exportedRefIds = new WeakMap<object, string>()
private decodedRemoteProxies = new Set<object>()
private supportsRemoteRefs: boolean
```

Initialize capability in the constructor:

```ts
this.supportsRemoteRefs =
	options.remoteRefs !== false && transport.capabilities?.remoteRefs !== false
```

- [ ] **Step 4: Add channel options for remote refs**

Modify `RPCChannelOptions` in `channel.ts`:

```ts
remoteRefs?: boolean
remoteRefPolicy?: "functions" | "off"
```

In the constructor, reject unknown policy values:

```ts
const policy = options.remoteRefPolicy ?? "functions"
if (policy !== "functions" && policy !== "off") {
	throw new Error(`Unsupported remoteRefPolicy: ${String(policy)}`)
}
```

- [ ] **Step 5: Implement function ref encoding**

Add helper methods to `RPCChannel`:

```ts
private createEncodeSession(transfers: Transferable[], path: string): EncodeSession {
	return { transfers, createdRefIds: [], seen: new WeakSet<object>(), path }
}

private registerLocalRef(target: object, kind: RemoteRefKind, explicit: boolean, session: EncodeSession): RemoteRefEnvelope {
	if (!this.supportsRemoteRefs) throw new RPCEncodeError(`Remote references are not supported by this channel at ${session.path}`)
	const existing = this.exportedRefIds.get(target)
	if (existing) return { __kkrpc_ref__: true, id: existing, kind }
	const id = generateId()
	this.exportedRefIds.set(target, id)
	this.localRefs.set(id, {
		id,
		kind,
		target,
		createdAt: Date.now(),
		lastUsedAt: Date.now(),
		released: false,
		explicit
	})
	session.createdRefIds.push(id)
	return { __kkrpc_ref__: true, id, kind }
}

private rollbackCreatedRefs(session: EncodeSession): void {
	for (const id of session.createdRefIds) {
		const record = this.localRefs.get(id)
		if (record && (typeof record.target === "object" || typeof record.target === "function") && record.target !== null) {
			this.exportedRefIds.delete(record.target as object)
		}
		this.localRefs.delete(id)
	}
}
```

- [ ] **Step 6: Replace encode/decode for function refs**

Refactor `encodeArgs()` and `encodeValue()` so they use sessions:

```ts
private encodeArgs(args: unknown[], transfers: Transferable[], path = "args"): unknown[] {
	const session = this.createEncodeSession(transfers, path)
	try {
		return args.map((arg, index) => this.encodeValueWithSession(arg, session, `${path}[${index}]`))
	} catch (error) {
		this.rollbackCreatedRefs(session)
		throw error
	}
}

private encodeValue(value: unknown, transfers: Transferable[], path = "value"): unknown {
	const session = this.createEncodeSession(transfers, path)
	try {
		return this.encodeValueWithSession(value, session, path)
	} catch (error) {
		this.rollbackCreatedRefs(session)
		throw error
	}
}
```

Add the recursive worker:

```ts
private encodeValueWithSession(value: unknown, session: EncodeSession, path: string): unknown {
	const remoteRecord = getRemoteProxyRecord(value)
	if (remoteRecord) return { __kkrpc_ref__: true, id: remoteRecord.id, kind: remoteRecord.kind } satisfies RemoteRefEnvelope
	if (typeof value === "function") return this.registerLocalRef(value, "function", false, session)
	if (typeof value !== "object" || value === null) return value

	const explicitProxy = isExplicitProxyTarget(value)
	const descriptor = this.supportsTransfer ? takeTransferDescriptor(value) : undefined
	if (explicitProxy && descriptor) throw new RPCEncodeError(`Cannot both proxy() and transfer() value at ${path}`)
	if (descriptor) {
		session.transfers.push(...descriptor.transfers)
		return descriptor.value
	}
	if (explicitProxy) return this.registerLocalRef(value, "object", true, session)
	if (isAsyncIterable(value)) return this.createStreamEnvelope(value)
	if (session.seen.has(value)) throw new RPCEncodeError(`Cannot encode cyclic value requiring remote-reference rewriting at ${path}`)

	session.seen.add(value)
	try {
		if (Array.isArray(value)) {
			let changed = false
			const next = value.map((item, index) => {
				const encoded = this.encodeValueWithSession(item, session, `${path}[${index}]`)
				if (encoded !== item) changed = true
				return encoded
			})
			return changed ? next : value
		}

		if (value instanceof Map) {
			let changed = false
			const next = new Map<unknown, unknown>()
			let index = 0
			for (const [key, item] of value) {
				const encodedKey = this.encodeValueWithSession(key, session, `${path}.<key${index}>`)
				const encodedValue = this.encodeValueWithSession(item, session, `${path}.<value${index}>`)
				if (encodedKey !== key || encodedValue !== item) changed = true
				next.set(encodedKey, encodedValue)
				index++
			}
			return changed ? next : value
		}

		if (value instanceof Set) {
			let changed = false
			const next = new Set<unknown>()
			let index = 0
			for (const item of value) {
				const encoded = this.encodeValueWithSession(item, session, `${path}.<set${index}>`)
				if (encoded !== item) changed = true
				next.add(encoded)
				index++
			}
			return changed ? next : value
		}

		if (value instanceof Date || value instanceof RegExp || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value

		let changed = false
		const source = value as Record<string, unknown>
		const next: Record<string, unknown> = Object.create(Object.getPrototypeOf(value))
		for (const key of Object.keys(source)) {
			const encoded = this.encodeValueWithSession(source[key], session, `${path}.${key}`)
			if (encoded !== source[key]) changed = true
			next[key] = encoded
		}
		return changed ? next : value
	} finally {
		session.seen.delete(value)
	}
}
```

Move the existing async iterable envelope creation into a helper:

```ts
private createStreamEnvelope(value: AsyncIterable<unknown>): StreamRefEnvelope {
	const id = generateId()
	this.localStreams.set(id, {
		iterator: value[Symbol.asyncIterator](),
		credit: 0,
		pumping: false,
		closed: false
	})
	return { [STREAM_REF_TAG]: "async-iterable", id }
}
```

- [ ] **Step 7: Implement recursive decode and function proxy calls**

Replace `decodeValue()` with a recursive function:

```ts
private decodeValue(value: unknown, decodedStreams?: AsyncIterable<unknown>[]): unknown {
	if (isStreamRefEnvelope(value)) {
		const iterable = this.createRemoteAsyncIterable(value.id)
		decodedStreams?.push(iterable)
		return iterable
	}
	if (isRemoteRefEnvelope(value)) return this.createRemoteRefProxy(value)
	if (Array.isArray(value)) return value.map((item) => this.decodeValue(item, decodedStreams))
	if (value instanceof Map) {
		return new Map(Array.from(value, ([key, item]) => [this.decodeValue(key, decodedStreams), this.decodeValue(item, decodedStreams)]))
	}
	if (value instanceof Set) return new Set(Array.from(value, (item) => this.decodeValue(item, decodedStreams)))
	if (typeof value === "object" && value !== null) {
		const source = value as Record<string, unknown>
		let changed = false
		const next: Record<string, unknown> = Object.create(Object.getPrototypeOf(value))
		for (const key of Object.keys(source)) {
			const decoded = this.decodeValue(source[key], decodedStreams)
			if (decoded !== source[key]) changed = true
			next[key] = decoded
		}
		return changed ? next : value
	}
	return value
}
```

Add function proxy creation:

```ts
private createRemoteRefProxy(envelope: RemoteRefEnvelope): unknown {
	if (envelope.kind === "function") {
		let released = false
		const fn = async (...args: unknown[]) => {
			if (released) throw new RPCRemoteReferenceReleasedError(envelope.id)
			return await this.request("ref", [envelope.id, "apply"], args)
		}
		registerRemoteProxy(fn, {
			id: envelope.id,
			kind: envelope.kind,
			released,
			markReleased: () => { released = true },
			release: async () => { await this.request("ref", [envelope.id, "release"]) }
		})
		this.decodedRemoteProxies.add(fn)
		return fn
	}
	return this.createRemoteObjectProxy(envelope)
}
```

For this task, `createRemoteObjectProxy()` may throw `new Error("Remote object proxies are not implemented yet")`; Task 6 replaces it.

- [ ] **Step 8: Dispatch `op: "ref"` before exposed API guard**

Modify `isRPCRequestMessage()` to include `"ref"` in `RPC_OPERATIONS`.

In `handleRequest()`, route ref requests first:

```ts
private async handleRequest(message: RPCRequest): Promise<void> {
	const transfers: Transferable[] = []
	try {
		const value = message.op === "ref" ? await this.executeRefRequest(message) : await this.executeRequest(message)
		if (this.destroyed) return
		this.post({ t: "r", id: message.id, v: this.encodeValue(value, transfers, "result") }, transfers)
	} catch (error) {
		if (this.destroyed) return
		this.post({ t: "r", id: message.id, e: this.encodeError(error) })
	}
}
```

Add `executeRefRequest()`:

```ts
private async executeRefRequest(message: RPCRequest): Promise<unknown> {
	const [refId, operation] = message.p
	if (!refId || !operation) throw new Error("Invalid remote reference request")
	const record = this.localRefs.get(refId)
	if (!record || record.released) throw new RPCRemoteReferenceReleasedError(refId)
	record.lastUsedAt = Date.now()

	if (operation === "release") {
		record.released = true
		this.localRefs.delete(refId)
		if ((typeof record.target === "object" || typeof record.target === "function") && record.target !== null) {
			this.exportedRefIds.delete(record.target as object)
		}
		return true
	}

	if (record.kind === "function" && operation === "apply") {
		if (typeof record.target !== "function") throw new Error(`Remote reference ${refId} is not callable`)
		const args = this.decodeArgs(message.a ?? [])
		return await Reflect.apply(record.target, undefined, args)
	}

	return await this.executeObjectRefRequest(record, operation, message)
}
```

For this task, `executeObjectRefRequest()` may throw until Task 6.

- [ ] **Step 9: Run function-ref tests**

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "nested returned function"`

Expected: PASS.

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "function argument can return"`

Expected: PASS.

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "wrap-style client"`

Expected: PASS.

- [ ] **Step 10: Commit Task 2**

```bash
git add packages/kkrpc/src/core/channel.ts packages/kkrpc/__tests__/remote-refs.test.ts
git commit -m "feat: route function references through rpc requests"
```

---

### Task 3: Cleanup, Release, Rollback, and Error Encoding

**Files:**

- Modify: `packages/kkrpc/src/core/channel.ts`
- Modify: `packages/kkrpc/__tests__/remote-refs.test.ts`

- [ ] **Step 1: Add failing cleanup and error tests**

Append tests to `remote-refs.test.ts`:

```ts
test("releaseProxy makes future function calls fail clearly", async () => {
	const [clientTransport, serverTransport] = createPair()
	const client = new RPCChannel<object, { create(): Promise<{ run(): Promise<string> }> }>(
		clientTransport
	)
	const server = new RPCChannel<{ create(): { run(): Promise<string> } }, object>(serverTransport, {
		expose: { create: () => ({ run: async () => "ok" }) }
	})

	const handle = await client.getAPI().create()
	expect(await handle.run()).toBe("ok")
	await releaseProxy(handle.run)
	await expect(handle.run()).rejects.toThrow("released")

	client.destroy()
	server.destroy()
})

test("same function repeated in one message reuses one ref id", async () => {
	const [clientTransport, serverTransport] = createPair()
	const fn = async () => "shared"
	const client = new RPCChannel<
		object,
		{ create(): Promise<{ a(): Promise<string>; b(): Promise<string> }> }
	>(clientTransport)
	const server = new RPCChannel<{ create(): { a: typeof fn; b: typeof fn } }, object>(
		serverTransport,
		{
			expose: { create: () => ({ a: fn, b: fn }) }
		}
	)

	const handle = await client.getAPI().create()
	expect(await handle.a()).toBe("shared")
	expect(await handle.b()).toBe("shared")
	const response = serverTransport.messages.find((message) => message.t === "r")
	expect(JSON.stringify(response).match(/__kkrpc_ref__/g)?.length).toBe(2)
	expect(
		JSON.stringify(response)
			.match(/"id":"([^"]+)"/g)
			?.at(0)
	).toBe(
		JSON.stringify(response)
			.match(/"id":"([^"]+)"/g)
			?.at(1)
	)

	client.destroy()
	server.destroy()
})

test("error custom fields decode nested function refs", async () => {
	const [clientTransport, serverTransport] = createPair()
	const client = new RPCChannel<object, { fail(): Promise<void> }>(clientTransport)
	const server = new RPCChannel<{ fail(): Promise<void> }, object>(serverTransport, {
		expose: {
			async fail() {
				const error = new Error("boom") as Error & { recover?: () => Promise<string> }
				error.recover = async () => "recovered"
				throw error
			}
		}
	})

	try {
		await client.getAPI().fail()
		throw new Error("expected fail() to reject")
	} catch (error) {
		expect(error).toBeInstanceOf(Error)
		expect(typeof (error as { recover?: unknown }).recover).toBe("function")
		expect(await (error as { recover: () => Promise<string> }).recover()).toBe("recovered")
	}

	client.destroy()
	server.destroy()
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "releaseProxy makes future"`

Expected: FAIL until release metadata and local rejection are complete.

- [ ] **Step 3: Complete release metadata and destroy cleanup**

Update `createRemoteRefProxy()` so `released` lives in the record object:

```ts
const record = {
	id: envelope.id,
	kind: envelope.kind,
	released: false,
	markReleased() {
		this.released = true
	},
	release: async () => {
		await this.request("ref", [envelope.id, "release"])
	}
}
```

Function proxy call should check `record.released`:

```ts
if (record.released) throw new RPCRemoteReferenceReleasedError(envelope.id)
```

In `destroy()`, mark decoded remote proxies released and clear refs:

```ts
for (const value of this.decodedRemoteProxies) {
	getRemoteProxyRecord(value)?.markReleased()
}
this.decodedRemoteProxies.clear()
this.localRefs.clear()
```

- [ ] **Step 4: Add encode error support for `RPCResponse.e`**

Replace `toRPCError()` / `fromRPCError()` usage with instance methods that encode/decode custom fields:

```ts
private encodeError(error: unknown): RPCError {
	const base = toRPCError(error)
	const transfers: Transferable[] = []
	for (const key of Object.keys(base)) {
		if (key === "n" || key === "m" || key === "s") continue
		base[key] = this.encodeValue(base[key], transfers, `error.${key}`)
	}
	return base
}

private decodeError(error: RPCError): Error {
	const result = fromRPCError(error)
	for (const key in error) {
		if (key === "n" || key === "m" || key === "s") continue
		Object.assign(result, { [key]: this.decodeValue(error[key]) })
	}
	return result
}
```

Use `this.decodeError(message.e)` in response and stream error paths.

- [ ] **Step 5: Add rollback on post write failure**

Thread an optional rollback into `post()`:

```ts
private post(
	message: RPCMessage,
	transfers: Transferable[] = [],
	pendingId?: string,
	onWriteError?: (error: Error) => void,
	onWriteSuccess?: () => void
): void {
	try {
		const result = this.transport.send(message, transfers)
		if (result instanceof Promise) {
			void result.then(onWriteSuccess, (error) => this.handleWriteFailure(pendingId, error, onWriteError))
			return
		}
		onWriteSuccess?.()
	} catch (error) {
		this.handleWriteFailure(pendingId, error, onWriteError)
	}
}
```

When sending a request or response with an encode session, pass rollback as `onWriteError` for refs created by that message. Keep existing pending rejection behavior.

- [ ] **Step 6: Run cleanup/error tests**

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "releaseProxy makes future"`

Expected: PASS.

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "error custom fields"`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add packages/kkrpc/src/core/channel.ts packages/kkrpc/__tests__/remote-refs.test.ts
git commit -m "feat: clean up remote references deterministically"
```

---

### Task 4: Transport Capability Gating and HTTP Rejection

**Files:**

- Modify: `packages/kkrpc/src/transports/http.ts`
- Modify: `packages/kkrpc/src/transports/stdio.ts`
- Modify: `packages/kkrpc/src/transports/ws.ts`
- Modify: `packages/kkrpc/src/transports/worker.ts`
- Modify: `packages/kkrpc/src/transports/ws-hono.ts`
- Modify: `packages/kkrpc/src/transports/ws-elysia.ts`
- Modify: `packages/kkrpc/src/transports/web-socket-client.ts`
- Modify: `packages/kkrpc/src/transports/socketio.ts`
- Modify: `packages/kkrpc/src/transports/rabbitmq.ts`
- Modify: `packages/kkrpc/src/transports/nats.ts`
- Modify: `packages/kkrpc/src/transports/redis-streams.ts`
- Modify: `packages/kkrpc/src/transports/kafka.ts`
- Modify: `packages/kkrpc/src/transports/iframe.ts`
- Modify: `packages/kkrpc/src/transports/chrome-extension.ts`
- Modify: `packages/kkrpc/__tests__/http.test.ts`
- Modify: `packages/kkrpc/__tests__/worker.test.ts`

- [ ] **Step 1: Add failing HTTP and Worker tests**

In `packages/kkrpc/__tests__/http.test.ts`, add:

```ts
test("HTTP rejects returned remote references with explicit error", async () => {
	const handler = createHttpHandler({ create: () => ({ hide: () => "hidden" }) })
	const transport = httpClientTransport({
		url: "http://local/rpc",
		fetch: handler as unknown as typeof fetch
	})
	const api = wrap<{ create(): Promise<{ hide(): Promise<string> }> }>(transport)

	await expect(api.create()).rejects.toThrow("HTTP transport does not support remote references")
	dispose(api)
})
```

In `packages/kkrpc/__tests__/worker.test.ts`, add:

```ts
test("worker transport returns callable nested function refs", async () => {
	const worker = new Worker(new URL("./scripts/remote-ref-worker.ts", import.meta.url).href, {
		type: "module"
	})
	const api = wrap<{ createToast(message: string): Promise<{ hide(): Promise<string> }> }>(
		workerTransport(worker)
	)

	try {
		const toast = await api.createToast("worker")
		expect(await toast.hide()).toBe("hidden:worker")
	} finally {
		dispose(api)
	}
})
```

Create `packages/kkrpc/__tests__/scripts/remote-ref-worker.ts`:

```ts
import { expose } from "../../src/entries/mod.ts"
import { workerSelfTransport } from "../../src/entries/worker.ts"

expose(
	{
		createToast(message: string) {
			return { hide: async () => `hidden:${message}` }
		}
	},
	workerSelfTransport()
)
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test packages/kkrpc/__tests__/http.test.ts -t "HTTP rejects returned remote references"`

Expected: FAIL because HTTP does not yet detect `__kkrpc_ref__`.

Run: `bun test packages/kkrpc/__tests__/worker.test.ts -t "worker transport returns callable"`

Expected: PASS only after Task 2 is working and Worker transport has `remoteRefs: true`; otherwise FAIL.

- [ ] **Step 3: Set transport capabilities**

For bidirectional transports, add `remoteRefs: true` to their capabilities objects. Examples:

```ts
capabilities: { objectMode: true, transfer: true, remoteRefs: true }
```

```ts
capabilities: { objectMode: false, transfer: false, remoteRefs: true }
```

For HTTP transports, set `remoteRefs: false`:

```ts
capabilities: { objectMode: true, transfer: false, remoteRefs: false }
```

- [ ] **Step 4: Replace HTTP unsupported envelope walkers**

Modify `packages/kkrpc/src/transports/http.ts` constants:

```ts
const ARG_ENVELOPE_TAG = "__kkrpc_next_arg__"
const STREAM_REF_TAG = "__kkrpc_next_stream__"
const REMOTE_REF_TAG = "__kkrpc_ref__"
```

Replace `containsCallbackEnvelope()` and `containsStreamRefEnvelope()` checks with:

```ts
function containsUnsupportedEnvelope(
	value: unknown,
	seen = new WeakSet<object>()
): "callback" | "stream" | "remote-ref" | undefined {
	if (typeof value !== "object" || value === null) return undefined
	if (seen.has(value)) return undefined
	seen.add(value)

	if (REMOTE_REF_TAG in value && (value as { [REMOTE_REF_TAG]?: unknown })[REMOTE_REF_TAG] === true)
		return "remote-ref"
	if (
		STREAM_REF_TAG in value &&
		(value as { [STREAM_REF_TAG]?: unknown })[STREAM_REF_TAG] === "async-iterable"
	)
		return "stream"
	if (
		ARG_ENVELOPE_TAG in value &&
		(value as { [ARG_ENVELOPE_TAG]?: unknown })[ARG_ENVELOPE_TAG] === "callback"
	)
		return "callback"

	if (Array.isArray(value)) {
		for (const item of value) {
			const result = containsUnsupportedEnvelope(item, seen)
			if (result) return result
		}
		return undefined
	}

	for (const item of Object.values(value)) {
		const result = containsUnsupportedEnvelope(item, seen)
		if (result) return result
	}
	return undefined
}
```

Use it in client and handler send paths:

```ts
const unsupported = containsUnsupportedEnvelope(message.a) ?? containsUnsupportedEnvelope(message.v)
if (unsupported)
	throw new Error(
		`HTTP transport does not support ${unsupported === "remote-ref" ? "remote references" : unsupported === "stream" ? "async iterable streams" : "callback arguments"}`
	)
```

- [ ] **Step 5: Run transport tests**

Run: `bun test packages/kkrpc/__tests__/http.test.ts -t "HTTP rejects returned remote references"`

Expected: PASS.

Run: `bun test packages/kkrpc/__tests__/worker.test.ts -t "worker transport returns callable"`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add packages/kkrpc/src/transports packages/kkrpc/__tests__/http.test.ts packages/kkrpc/__tests__/worker.test.ts packages/kkrpc/__tests__/scripts/remote-ref-worker.ts
git commit -m "feat: gate remote references by transport capability"
```

---

### Task 5: Streams, Validation, Transfer, and Concurrency Regression Tests

**Files:**

- Modify: `packages/kkrpc/__tests__/remote-refs.test.ts`
- Modify: `packages/kkrpc/__tests__/validation.test.ts`
- Modify: `packages/kkrpc/src/features/validation.ts`
- Modify: `packages/kkrpc/src/core/channel.ts`

- [ ] **Step 1: Add failing regression tests**

Append to `remote-refs.test.ts`:

```ts
test("concurrent calls to the same remote function ref resolve independently", async () => {
	const [clientTransport, serverTransport] = createPair()
	const client = new RPCChannel<object, { create(): Promise<() => Promise<string>> }>(
		clientTransport
	)
	let count = 0
	const server = new RPCChannel<{ create(): () => Promise<string> }, object>(serverTransport, {
		expose: { create: () => async () => `call:${++count}` }
	})

	const fn = await client.getAPI().create()
	const results = await Promise.all([fn(), fn()])
	expect(results.sort()).toEqual(["call:1", "call:2"])

	client.destroy()
	server.destroy()
})

test("stream chunks decode nested function refs", async () => {
	const [clientTransport, serverTransport] = createPair()
	type API = { values(): AsyncIterable<{ run(): Promise<string> }> }
	const client = new RPCChannel<object, API>(clientTransport)
	const server = new RPCChannel<API, object>(serverTransport, {
		expose: {
			async *values() {
				yield { run: async () => "chunk-ref" }
			}
		}
	})

	for await (const item of client.getAPI().values()) {
		expect(await item.run()).toBe("chunk-ref")
		break
	}

	client.destroy()
	server.destroy()
})

test("transfer descriptors still send exactly one transferable", async () => {
	const [clientTransport, serverTransport] = createPair()
	const client = new RPCChannel<object, { take(buffer: ArrayBuffer): Promise<number> }>(
		clientTransport
	)
	const server = new RPCChannel<{ take(buffer: ArrayBuffer): number }, object>(serverTransport, {
		expose: { take: (buffer) => buffer.byteLength }
	})
	const buffer = new ArrayBuffer(8)

	expect(await client.getAPI().take(transfer(buffer, [buffer]))).toBe(8)
	expect(clientTransport.transfers[0]).toHaveLength(1)

	client.destroy()
	server.destroy()
})
```

Add validation test to `packages/kkrpc/__tests__/validation.test.ts`:

```ts
test("validation keeps callback arguments filtered with remote refs", async () => {
	const [a, b] = createPair()
	const seenInputs: unknown[] = []
	const inputSchema = {
		"~standard": {
			version: 1 as const,
			vendor: "test",
			validate(value: unknown) {
				seenInputs.push(value)
				return { value }
			}
		}
	}
	const client = new RPCChannel<
		object,
		{ use(value: string, callback: () => Promise<string>): Promise<string> }
	>(a)
	const server = new RPCChannel<
		{ use(value: string, callback: () => Promise<string>): Promise<string> },
		object
	>(b, {
		expose: { use: async (_value, callback) => await callback() },
		plugins: [validationPlugin({ use: { input: inputSchema } })]
	})

	expect(await client.getAPI().use("ok", async () => "callback-ok")).toBe("callback-ok")
	expect(seenInputs).toEqual([["ok"]])

	client.destroy()
	server.destroy()
})
```

- [ ] **Step 2: Run regression tests**

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "concurrent calls"`

Expected: PASS after Task 2 request ids are independent.

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "stream chunks"`

Expected: PASS after recursive decode covers stream chunks.

Run: `bun test packages/kkrpc/__tests__/validation.test.ts -t "validation keeps callback"`

Expected: PASS after `validationPlugin` ignores `operation: "ref"` and keeps filtering function args.

- [ ] **Step 3: Update validation plugin for `op: "ref"`**

Modify `packages/kkrpc/src/features/validation.ts`:

```ts
async function validateInput(
	validators: Record<string, unknown> | undefined,
	ctx: RPCRequestContext
): Promise<void> {
	if (ctx.operation === "ref") return
	if (ctx.operation !== "call" && ctx.operation !== "new") return
	const methodValidators = lookupValidator(validators, ctx.method)
	const result = await runValidation(methodValidators?.input, filterCallbacks(ctx.args))
	if (!result.success) throw new RPCValidationError("input", ctx.method, result.issues)
	ctx.args = mergeValidatedArgs(ctx.args, result.value)
}

async function validateOutput(
	validators: Record<string, unknown> | undefined,
	ctx: RPCResponseContext
): Promise<void> {
	if (ctx.operation === "ref") return
	if (ctx.operation !== "call" && ctx.operation !== "new") return
	const methodValidators = lookupValidator(validators, ctx.method)
	const result = await runValidation(methodValidators?.output, ctx.result)
	if (!result.success) throw new RPCValidationError("output", ctx.method, result.issues)
	ctx.result = result.value
}
```

- [ ] **Step 4: Run package tests for changed areas**

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts packages/kkrpc/__tests__/validation.test.ts packages/kkrpc/__tests__/core.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add packages/kkrpc/__tests__/remote-refs.test.ts packages/kkrpc/__tests__/validation.test.ts packages/kkrpc/src/features/validation.ts packages/kkrpc/src/core/channel.ts
git commit -m "test: cover remote reference regressions"
```

---

### Task 6: Explicit Object Proxy Support

**Files:**

- Modify: `packages/kkrpc/src/core/channel.ts`
- Modify: `packages/kkrpc/__tests__/remote-refs.test.ts`

- [ ] **Step 1: Add failing object proxy tests**

Append to `remote-refs.test.ts`:

```ts
test("explicit object proxy supports get set and method call", async () => {
	class Counter {
		value = 1
		increment(amount: number) {
			this.value += amount
			return this.value
		}
	}

	const [clientTransport, serverTransport] = createPair()
	const client = new RPCChannel<object, { createCounter(): Promise<Counter> }>(clientTransport)
	const server = new RPCChannel<{ createCounter(): Counter }, object>(serverTransport, {
		expose: { createCounter: () => proxy(new Counter()) }
	})

	const counter = await client.getAPI().createCounter()
	expect(await counter.value).toBe(1)
	expect(await counter.increment(2)).toBe(3)
	counter.value = 10
	await new Promise((resolve) => setTimeout(resolve, 0))
	expect(await counter.value).toBe(10)
	await releaseProxy(counter)
	await expect(counter.increment(1)).rejects.toThrow("released")

	client.destroy()
	server.destroy()
})
```

- [ ] **Step 2: Run object proxy test to verify failure**

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "explicit object proxy"`

Expected: FAIL because `createRemoteObjectProxy()` and `executeObjectRefRequest()` are not implemented.

- [ ] **Step 3: Implement remote object proxy nodes**

Add to `channel.ts`:

```ts
private createRemoteObjectProxy(envelope: RemoteRefEnvelope): unknown {
	const makeNode = (path: string[]): unknown => {
		const target = function () {}
		const record = {
			id: envelope.id,
			kind: envelope.kind,
			released: false,
			markReleased() { this.released = true },
			release: async () => { await this.request("ref", [envelope.id, "release"]) }
		}
		const proxyValue = new Proxy(target, {
			get: (_target, property, receiver) => {
				if (property === "then") {
					if (path.length === 0) return undefined
					const promise = this.request("ref", [envelope.id, "get", ...path])
					return promise.then.bind(promise)
				}
				if (typeof property === "symbol") return Reflect.get(_target, property, receiver)
				if (property === "bind" || property === "call" || property === "apply") return Reflect.get(_target, property, receiver)
				return makeNode([...path, property])
			},
			set: (_target, property, value) => {
				if (typeof property === "symbol" || record.released) return false
				void this.request("ref", [envelope.id, "set", ...path, property], undefined, value).catch(() => {})
				return true
			},
			apply: (_target, _thisArg, args) => {
				if (record.released) return Promise.reject(new RPCRemoteReferenceReleasedError(envelope.id))
				return this.request("ref", [envelope.id, "call", ...path], Array.from(args))
			}
		})
		registerRemoteProxy(proxyValue, record)
		this.decodedRemoteProxies.add(proxyValue)
		return proxyValue
	}
	return makeNode([])
}
```

- [ ] **Step 4: Implement object ref request execution**

Add to `channel.ts`:

```ts
private async executeObjectRefRequest(record: RefRecord, operation: string, message: RPCRequest): Promise<unknown> {
	if (record.kind !== "object") throw new Error(`Remote reference ${record.id} is not an object`)
	const propertyPath = message.p.slice(2)
	const target = record.target
	if (operation === "get") return getPath(target, propertyPath)
	if (operation === "set") {
		const value = this.decodeValue(message.v)
		const { parent, key } = getParent(target, propertyPath)
		Reflect.set(parent, key, value)
		return true
	}
	if (operation === "call") {
		const method = getPath(target, propertyPath)
		if (typeof method !== "function") throw new Error(`${propertyPath.join(".")} is not a function`)
		const receiver = propertyPath.length > 0 ? getPath(target, propertyPath.slice(0, -1)) : target
		return await Reflect.apply(method, receiver, this.decodeArgs(message.a ?? []))
	}
	throw new Error(`Unsupported remote object operation ${operation}`)
}
```

- [ ] **Step 5: Run object proxy tests**

Run: `bun test packages/kkrpc/__tests__/remote-refs.test.ts -t "explicit object proxy"`

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add packages/kkrpc/src/core/channel.ts packages/kkrpc/__tests__/remote-refs.test.ts
git commit -m "feat: add explicit remote object proxies"
```

---

### Task 7: Examples Demo Package

**Files:**

- Create: `examples/remote-references-demo/package.json`
- Create: `examples/remote-references-demo/tsconfig.json`
- Create: `examples/remote-references-demo/main.ts`
- Create: `examples/remote-references-demo/worker.ts`
- Create: `examples/remote-references-demo/README.md`

- [ ] **Step 1: Create example package files**

Create `examples/remote-references-demo/package.json`:

```json
{
	"name": "remote-references-demo",
	"private": true,
	"type": "module",
	"scripts": {
		"demo": "bun run main.ts",
		"check-types": "tsc --noEmit"
	},
	"dependencies": {
		"kkrpc": "workspace:*"
	},
	"devDependencies": {
		"@types/bun": "latest",
		"typescript": "^5.0.0"
	}
}
```

Create `examples/remote-references-demo/tsconfig.json`:

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "ESNext",
		"moduleResolution": "Bundler",
		"strict": true,
		"skipLibCheck": true,
		"types": ["bun-types"]
	},
	"include": ["*.ts"]
}
```

- [ ] **Step 2: Add Worker demo code**

Create `examples/remote-references-demo/worker.ts`:

```ts
import { expose, proxy } from "kkrpc"
import { workerSelfTransport } from "kkrpc/worker"

class CounterHandle {
	value = 0

	increment(amount: number) {
		this.value += amount
		return this.value
	}
}

const api = {
	createToast(message: string) {
		return {
			hide: async () => `hidden:${message}`
		}
	},

	async useCallback(callback: (value: string) => Promise<string>) {
		return await callback("from-worker")
	},

	createCounter() {
		return proxy(new CounterHandle())
	}
}

expose(api, workerSelfTransport())
```

Create `examples/remote-references-demo/main.ts`:

```ts
import { releaseProxy, wrap } from "kkrpc"
import { workerTransport } from "kkrpc/worker"

interface ToastHandle {
	hide(): Promise<string>
}

interface CounterHandle {
	value: number
	increment(amount: number): Promise<number>
}

interface DemoAPI {
	createToast(message: string): Promise<ToastHandle>
	useCallback(callback: (value: string) => Promise<string>): Promise<string>
	createCounter(): Promise<CounterHandle>
}

const worker = new Worker(new URL("./worker.ts", import.meta.url).href, { type: "module" })
const api = wrap<DemoAPI>(workerTransport(worker))

try {
	const toast = await api.createToast("hello")
	console.log(await toast.hide())

	const callbackResult = await api.useCallback(async (value) => `callback:${value}`)
	console.log(callbackResult)

	const counter = await api.createCounter()
	console.log(await counter.value)
	console.log(await counter.increment(5))
	await releaseProxy(counter)
	await releaseProxy(toast.hide)
} finally {
	worker.terminate()
}
```

- [ ] **Step 3: Add README**

Create `examples/remote-references-demo/README.md`:

````md
# Remote References Demo

This example demonstrates kkrpc remote references across a Worker boundary.

It covers:

- A returned plain object with a nested function leaf: `createToast().hide()`.
- A callback argument whose return value is awaited by the worker: `useCallback()`.
- An explicitly proxied class instance: `createCounter()` returns `proxy(new CounterHandle())`.
- Deterministic cleanup through `releaseProxy()`.

Run:

```bash
pnpm --filter remote-references-demo demo
```

Expected output:

```text
hidden:hello
callback:from-worker
0
5
```
````

- [ ] **Step 4: Run example type check and demo**

Run: `pnpm --filter remote-references-demo check-types`

Expected: PASS.

Run: `pnpm --filter remote-references-demo demo`

Expected output contains:

```text
hidden:hello
callback:from-worker
0
5
```

- [ ] **Step 5: Commit Task 7**

```bash
git add examples/remote-references-demo
git commit -m "docs: add remote references demo"
```

---

### Task 8: Docs Site Update

**Files:**

- Create or modify: `docs/src/content/docs/guides/remote-references.md`
- Modify: `docs/src/content/docs/llms.txt` if it is manually maintained and includes feature summaries
- Modify: `docs/astro.config.mjs` only if navigation/sidebar needs an explicit new guide entry

- [ ] **Step 1: Inspect docs content structure**

Read the current docs guide structure:

```bash
ls docs/src/content/docs/guides
```

Expected: guide markdown files showing where a remote references guide should live.

- [ ] **Step 2: Add remote references guide**

Create `docs/src/content/docs/guides/remote-references.md` with frontmatter matching existing docs style. Include these sections:

````md
---
title: Remote References
description: Pass callback functions and explicit object proxies across bidirectional kkrpc transports.
---

# Remote References

Remote references let kkrpc pass functions by reference across bidirectional transports. They are useful when a value contains callback leaves, such as a returned toast handle with a `hide()` method, or when a remote API needs to call a callback and await its return value.

## Function leaves

```ts
const toast = await api.createToast("hello")
await toast.hide()
```
````

Plain objects still cross by value. Only function leaves become remote function references.

## Callback return values

```ts
await api.useCallback(async (value) => `callback:${value}`)
```

Remote callback calls are request/response based, so returned values resolve and thrown errors reject.

## Explicit object proxies

```ts
import { proxy } from "kkrpc"

return proxy(new CounterHandle())
```

Use object proxies only for intentional long-lived remote handles. Do not proxy DOM events, DOM nodes, or host internals unless the API is explicitly designed for that trust boundary.

## Cleanup

```ts
import { releaseProxy } from "kkrpc"

await releaseProxy(counter)
```

Call `releaseProxy()` for long-lived handles. `channel.destroy()` releases all refs owned by that channel.

## Transport support

Remote references require bidirectional transports. Worker, iframe, WebSocket, stdio, Electron, Tauri, Chrome extension ports, Socket.IO, and supported message-bus transports can support them. Unary HTTP rejects remote references with a clear error because it cannot carry follow-up callback calls.

## Complete demo

See `examples/remote-references-demo` for a Worker example covering returned function leaves, callback return values, explicit object proxies, and deterministic cleanup.

````

- [ ] **Step 3: Update docs navigation if required**

If existing docs navigation is explicit in `docs/astro.config.mjs`, add the new guide entry beside related guide pages. If navigation is auto-generated, do not edit config.

- [ ] **Step 4: Update LLM summary if manually maintained**

If `docs/src/content/docs/llms.txt` exists and is manually maintained, add a short remote references summary with the supported transports and cleanup API.

- [ ] **Step 5: Run docs checks**

Run: `pnpm --filter docs build`

Expected: PASS.

Run: `pnpm --filter docs check` if the docs package defines a `check` script.

Expected: PASS or script not found if the docs package has no check script.

- [ ] **Step 6: Commit Task 8**

```bash
git add docs/src/content/docs docs/astro.config.mjs
git commit -m "docs: document remote references"
````

---

### Task 9: Full Verification and Bundle Impact

**Files:**

- Modify: `docs/superpowers/specs/2026-06-12-remote-references-design.md` if verification finds a documented gap
- Test: all changed tests and examples

- [ ] **Step 1: Run package type check**

Run: `pnpm --filter kkrpc check-types`

Expected: PASS.

- [ ] **Step 2: Run kkrpc tests**

Run: `pnpm --filter kkrpc test`

Expected: PASS, including Bun and Deno regressions invoked by the package script.

- [ ] **Step 3: Run examples type checks**

Run: `pnpm --filter "./examples/*" check-types`

Expected: PASS for examples that define a `check-types` script. If any existing example lacks the script, pnpm reports it as skipped rather than a failure.

- [ ] **Step 4: Run remote references demo**

Run: `pnpm --filter remote-references-demo demo`

Expected output:

```text
hidden:hello
callback:from-worker
0
5
```

- [ ] **Step 5: Measure bundle impact**

Run: `pnpm --filter kkrpc compare:browser-bundle-size`

Expected: command completes and reports browser/core entry size. If gzipped increase exceeds 5KB, document the increase and the reason in the spec before finishing.

- [ ] **Step 6: Run root formatting check or format**

Run: `pnpm format`

Expected: Prettier formats changed TypeScript, Markdown, and example files.

- [ ] **Step 7: Run docs build**

Run: `pnpm --filter docs build`

Expected: PASS.

- [ ] **Step 8: Inspect final status and diff**

Run: `git status --short && git diff --stat`

Expected: only intended source, tests, example, docs, and changeset files are modified.

- [ ] **Step 9: Commit final verification updates**

```bash
git add packages/kkrpc/src packages/kkrpc/__tests__ examples/remote-references-demo docs/src/content/docs docs/superpowers/specs/2026-06-12-remote-references-design.md
git commit -m "feat: support remote references"
```

---

## Self-Review Notes

- Spec coverage: Tasks 1-6 cover protocol `op: "ref"`, function refs, callback return/error propagation, cleanup, transport gating, validation behavior, transfer preservation, object proxies, and test coverage. Task 7 covers the requested examples demo. Task 8 covers the requested docs site update. Task 9 covers bundle impact and full verification.
- Map/Set scope: tests are included for nested function leaves in Map/Set, but codec-specific behavior remains limited to transports/codecs that preserve those containers by value. This matches the revised spec.
- FinalizationRegistry: intentionally not implemented in this plan because the revised spec makes it optional and not a correctness dependency.
- Legacy `RPCCallback`: remains in the active protocol in Task 1 because existing callback emission still uses `t: "cb"`; Task 2 removes it after function refs replace callback emission. No receive-only legacy compatibility is included after that replacement.
