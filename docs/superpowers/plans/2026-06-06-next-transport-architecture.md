# kkrpc Next Transport Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `kkrpc/next` public preview with a composable RPC core, `wrap`/`expose` shorthand APIs, transport/platform/codec separation, worker object transport, and stdio JSON transport.

**Architecture:** Implement vNext as a separate entry family that does not change current `kkrpc`, `kkrpc/browser`, or `kkrpc/browser-lite`. The core consumes a normalized `Transport<RPCMessage>`, while presets compose platform communication and codecs. The first slice validates the architecture with worker object mode, strict JSON codecs, JSON-line stdio streams, tests, and bundle benchmarks.

**Tech Stack:** TypeScript, Bun test runner, Bun workers, Node streams, tsdown package build, Bun bundle metafiles.

**Execution Note:** Do not commit unless the user explicitly asks. Use diff checkpoints instead of commit steps because this workspace has unrelated uncommitted changes.

---

## File Structure

- Create: `packages/kkrpc/src/next/protocol.ts`
- Responsibility: Compact vNext wire message and error types.

- Create: `packages/kkrpc/src/next/transport.ts`
- Responsibility: `Transport`, `Platform`, `Codec`, capabilities, `createTransport`, and transport utility types.

- Create: `packages/kkrpc/src/next/channel.ts`
- Responsibility: vNext `RPCChannel`, core proxy behavior, callback placeholders, top-level transfer support, timeouts, dispose cleanup, and write-failure handling.

- Create: `packages/kkrpc/src/next/index.ts`
- Responsibility: Public core exports plus `wrap`, `expose`, `dispose`, and controller types.

- Create: `packages/kkrpc/src/next/codecs.ts`
- Responsibility: `objectCodec`, `jsonCodec`, and `jsonLineCodec`.

- Create: `packages/kkrpc/src/next/worker.ts`
- Responsibility: Worker object-mode transports: `workerTransport(worker)` and `workerSelfTransport(scope?)`.

- Create: `packages/kkrpc/src/next/stdio.ts`
- Responsibility: Node-style explicit stream stdio platform, `stdioJsonTransport({ readable, writable })`, and `nodeStdioTransport()` shortcut.

- Create: `packages/kkrpc/next.ts`
- Responsibility: `kkrpc/next` source entry.

- Create: `packages/kkrpc/next-codecs.ts`
- Responsibility: `kkrpc/next/codecs` source entry.

- Create: `packages/kkrpc/next-transport.ts`
- Responsibility: `kkrpc/next/transport` source entry.

- Create: `packages/kkrpc/next-worker.ts`
- Responsibility: `kkrpc/next/worker` source entry.

- Create: `packages/kkrpc/next-stdio.ts`
- Responsibility: `kkrpc/next/stdio` source entry.

- Create: `packages/kkrpc/__tests__/next-core.test.ts`
- Responsibility: In-memory transport tests for `RPCChannel`, `wrap`, `expose`, `dispose`, callbacks, properties, constructors, transfers, timeout, and write failures.

- Create: `packages/kkrpc/__tests__/next-transport-codecs.test.ts`
- Responsibility: Codec and `createTransport` tests.

- Create: `packages/kkrpc/__tests__/next-worker.test.ts`
- Responsibility: Real Worker preset tests.

- Create: `packages/kkrpc/__tests__/scripts/next-worker.ts`
- Responsibility: Worker fixture exposing vNext API.

- Create: `packages/kkrpc/__tests__/next-stdio.test.ts`
- Responsibility: Explicit stream-pair stdio JSON transport tests.

- Modify: `packages/kkrpc/package.json`
- Responsibility: Add `./next`, `./next/worker`, `./next/stdio`, `./next/transport`, and `./next/codecs` exports.

- Modify: `packages/kkrpc/tsdown.config.ts`
- Responsibility: Add vNext entries.

- Modify: `packages/kkrpc/scripts/compare-browser-bundle-size.ts`
- Responsibility: Add vNext benchmark cases.

- Modify: `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts`
- Responsibility: Update benchmark helper expectations for vNext cases.

---

### Task 1: vNext Core API Tests And Implementation

**Files:**

- Create: `packages/kkrpc/__tests__/next-core.test.ts`
- Create: `packages/kkrpc/src/next/protocol.ts`
- Create: `packages/kkrpc/src/next/transport.ts`
- Create: `packages/kkrpc/src/next/channel.ts`
- Create: `packages/kkrpc/src/next/index.ts`
- Create: `packages/kkrpc/next.ts`

- [ ] **Step 1: Write failing core tests**

Create `packages/kkrpc/__tests__/next-core.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { dispose, expose, RPCChannel, transfer, wrap } from "../next.ts"
import type { RPCMessage, Transport } from "../next.ts"

interface RemoteWidget {
	name: string
}

interface RemoteAPI {
	math: {
		add(a: number, b: number): Promise<number>
	}
	config: {
		name: string
	}
	counter: {
		getValue(): Promise<number>
	}
	callCallback(value: number, callback: (value: number) => void): Promise<void>
	Widget: new (name: string) => Promise<RemoteWidget>
	takeBuffer(buffer: ArrayBuffer): Promise<number>
	hang(): Promise<void>
}

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true }
	peer?: MemoryTransport
	listener?: (message: RPCMessage) => void
	closed = false
	postError?: Error
	transfers: Transferable[][] = []

	send(message: RPCMessage, transfers: Transferable[] = []): void {
		if (this.postError) throw this.postError
		this.transfers.push(transfers)
		queueMicrotask(() => this.peer?.listener?.(message))
	}

	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listener = listener
		return () => {
			this.listener = undefined
		}
	}

	close(): void {
		this.closed = true
	}
}

function createPair() {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return { a, b }
}

function createApi() {
	const config = { name: "initial" }
	class Widget {
		name: string

		constructor(name: string) {
			this.name = name
		}
	}
	return {
		math: {
			add: async (a: number, b: number) => a + b
		},
		config,
		counter: {
			value: 4,
			getValue() {
				return this.value
			}
		},
		callCallback: async (value: number, callback: (value: number) => void) => {
			callback(value + 1)
		},
		Widget,
		takeBuffer: async (buffer: ArrayBuffer) => buffer.byteLength,
		hang: async () => new Promise(() => {})
	}
}

describe("kkrpc/next core", () => {
	test("RPCChannel supports calls, properties, constructors, callbacks, and parent this", async () => {
		const { a, b } = createPair()
		const server = new RPCChannel<ReturnType<typeof createApi>, Record<string, never>>(b, {
			expose: createApi()
		})
		const client = new RPCChannel<Record<string, never>, RemoteAPI>(a)
		const api = client.getAPI()

		try {
			expect(await api.math.add(2, 5)).toBe(7)
			expect(await api.config.name).toBe("initial")
			api.config.name = "updated"
			expect(await api.config.name).toBe("updated")
			expect(await api.counter.getValue()).toBe(4)
			expect(await new api.Widget("demo")).toEqual({ name: "demo" })

			let completeCall: Promise<void> | undefined
			const callbackResult = new Promise<number>((resolve) => {
				completeCall = api.callCallback(9, resolve)
			})
			expect(await callbackResult).toBe(10)
			await completeCall
		} finally {
			client.destroy()
			server.destroy()
		}
	})

	test("wrap, expose, and dispose are shorthand over RPCChannel", async () => {
		const { a, b } = createPair()
		const controller = expose(createApi(), b)
		const api = wrap<RemoteAPI>(a)

		try {
			expect(await api.math.add(1, 2)).toBe(3)
		} finally {
			dispose(api)
			controller.dispose()
		}

		expect(a.closed).toBe(true)
		expect(b.closed).toBe(true)
	})

	test("transfers top-level marked values when transport supports transfer", async () => {
		const { a, b } = createPair()
		const server = new RPCChannel<ReturnType<typeof createApi>, Record<string, never>>(b, {
			expose: createApi()
		})
		const client = new RPCChannel<Record<string, never>, RemoteAPI>(a)
		const api = client.getAPI()
		const buffer = new ArrayBuffer(8)

		try {
			expect(await api.takeBuffer(transfer(buffer, [buffer]))).toBe(8)
			expect(a.transfers[0]).toHaveLength(1)
		} finally {
			client.destroy()
			server.destroy()
		}
	})

	test("does not consume transfer descriptors when transfer is disabled", () => {
		const { a } = createPair()
		const client = new RPCChannel<Record<string, never>, RemoteAPI>(a, { enableTransfer: false })
		const api = client.getAPI()
		const buffer = new ArrayBuffer(8)

		try {
			void api.takeBuffer(transfer(buffer, [buffer])).catch(() => {})
			expect(a.transfers[0]).toHaveLength(0)
			expect(buffer.byteLength).toBe(8)
		} finally {
			client.destroy()
		}
	})

	test("rejects timed out requests and write failures", async () => {
		const { a } = createPair()
		const timeoutClient = new RPCChannel<Record<string, never>, RemoteAPI>(a, { timeout: 10 })
		const timeoutApi = timeoutClient.getAPI()

		try {
			await expect(timeoutApi.hang()).rejects.toThrow("timed out after 10ms")
		} finally {
			timeoutClient.destroy()
		}

		const failing = new MemoryTransport()
		failing.postError = new Error("write failed")
		const failingClient = new RPCChannel<Record<string, never>, { ping(): Promise<void> }>(failing)
		const failingApi = failingClient.getAPI()

		try {
			await expect(failingApi.ping()).rejects.toThrow("write failed")
		} finally {
			failingClient.destroy()
		}
	})
})
```

- [ ] **Step 2: Run the failing core tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-core.test.ts
```

Expected: FAIL because `../next.ts` does not exist yet.

- [ ] **Step 3: Implement protocol and transport types**

Create `packages/kkrpc/src/next/protocol.ts`:

```ts
export interface RPCError {
	n: string
	m: string
	s?: string
}

export type RPCOperation = "call" | "get" | "set" | "new"

export interface RPCRequest {
	t: "q"
	id: string
	op: RPCOperation
	p: string[]
	a?: unknown[]
	v?: unknown
}

export interface RPCResponse {
	t: "r"
	id: string
	v?: unknown
	e?: RPCError
}

export interface RPCCallback {
	t: "cb"
	id: string
	a: unknown[]
}

export type RPCMessage = RPCRequest | RPCResponse | RPCCallback
```

Create `packages/kkrpc/src/next/transport.ts`:

```ts
export interface TransportCapabilities {
	objectMode?: boolean
	transfer?: boolean
	broadcast?: boolean
}

export interface PlatformCapabilities {
	objectMode?: boolean
	transfer?: boolean
}

export interface CodecCapabilities {
	transfer?: boolean
}

export interface Transport<TMessage> {
	send(message: TMessage, transfers?: Transferable[]): void | Promise<void>
	subscribe(listener: (message: TMessage) => void): () => void
	close?(): void
	capabilities?: TransportCapabilities
}

export interface Platform<TWire> {
	send(wire: TWire, transfers?: Transferable[]): void | Promise<void>
	subscribe(listener: (wire: TWire) => void): () => void
	close?(): void
	capabilities?: PlatformCapabilities
}

export interface Codec<TMessage, TWire> {
	encode(message: TMessage): TWire
	decode(wire: TWire): TMessage
	capabilities?: CodecCapabilities
}
```

- [ ] **Step 4: Implement `RPCChannel` and shorthand helpers**

Create `packages/kkrpc/src/next/channel.ts` by adapting `src/browser-mini/channel.ts` with these required changes:

```ts
import { takeTransferDescriptor } from "../transfer.ts"
import type { RPCError, RPCMessage, RPCOperation, RPCRequest } from "./protocol.ts"
import type { Transport } from "./transport.ts"

export interface RPCChannelOptions<LocalAPI extends object = object> {
	expose?: LocalAPI
	timeout?: number
	enableTransfer?: boolean
}

type PendingRequest = {
	resolve(value: unknown): void
	reject(error: Error): void
	timer?: ReturnType<typeof setTimeout>
}

const ARG_ENVELOPE_TAG = "__kkrpc_next_arg__"

type ValueArgEnvelope = {
	[ARG_ENVELOPE_TAG]: "value"
	v: unknown
}

type CallbackArgEnvelope = {
	[ARG_ENVELOPE_TAG]: "callback"
	id: string
}

type ArgEnvelope = ValueArgEnvelope | CallbackArgEnvelope

function isArgEnvelope(value: unknown): value is ArgEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		ARG_ENVELOPE_TAG in value &&
		((value as { [ARG_ENVELOPE_TAG]: unknown })[ARG_ENVELOPE_TAG] === "value" ||
			(value as { [ARG_ENVELOPE_TAG]: unknown })[ARG_ENVELOPE_TAG] === "callback")
	)
}

function generateId(): string {
	return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

function toRPCError(error: unknown): RPCError {
	if (error instanceof Error) return { n: error.name, m: error.message, s: error.stack }
	return { n: "Error", m: String(error) }
}

function fromRPCError(error: RPCError): Error {
	const result = new Error(error.m)
	result.name = error.n
	if (error.s) result.stack = error.s
	return result
}

function getPath(root: unknown, path: string[]): unknown {
	let current = root
	for (const segment of path) {
		if (current === null || current === undefined) {
			throw new Error(`Cannot access ${segment} on ${String(current)}`)
		}
		current = Reflect.get(Object(current), segment)
	}
	return current
}

function getParent(root: unknown, path: string[]): { parent: object; key: string } {
	if (path.length === 0) throw new Error("Cannot set empty path")
	const parent = getPath(root, path.slice(0, -1))
	if (parent === null || parent === undefined) {
		throw new Error(`Cannot set ${path.join(".")} on ${String(parent)}`)
	}
	return { parent: Object(parent), key: path[path.length - 1] }
}

export class RPCChannel<LocalAPI extends object = object, RemoteAPI extends object = object> {
	private callbacks = new Map<string, (...args: unknown[]) => unknown>()
	private destroyed = false
	private pending = new Map<string, PendingRequest>()
	private supportsTransfer: boolean
	private unsubscribe: () => void
	private timeout: number
	private expose?: LocalAPI

	constructor(
		private transport: Transport<RPCMessage>,
		options: RPCChannelOptions<LocalAPI> = {}
	) {
		this.expose = options.expose
		this.supportsTransfer =
			options.enableTransfer !== false && transport.capabilities?.transfer === true
		this.timeout = options.timeout ?? 30_000
		this.unsubscribe = transport.subscribe((message) => this.handleMessage(message))
	}

	getAPI(): RemoteAPI {
		return this.createProxy([]) as RemoteAPI
	}

	destroy(): void {
		if (this.destroyed) return
		this.destroyed = true
		this.unsubscribe()
		for (const pending of this.pending.values()) {
			if (pending.timer) clearTimeout(pending.timer)
			pending.reject(new Error("RPC channel destroyed"))
		}
		this.pending.clear()
		this.callbacks.clear()
		this.transport.close?.()
	}

	private createProxy(path: string[]): unknown {
		const target = function () {}
		return new Proxy(target, {
			get: (target, property, receiver) => {
				if (property === "then") {
					if (path.length === 0) return undefined
					const promise = this.request("get", path)
					return promise.then.bind(promise)
				}
				if (typeof property === "symbol") return Reflect.get(target, property, receiver)
				return this.createProxy([...path, property])
			},
			set: (_target, property, value) => {
				if (typeof property === "symbol") return false
				void this.request("set", [...path, property], undefined, value).catch(() => {})
				return true
			},
			apply: (_target, _thisArg, args) => this.request("call", path, Array.from(args)),
			construct: (_target, args) => this.request("new", path, Array.from(args))
		})
	}

	private request(
		op: RPCOperation,
		path: string[],
		args?: unknown[],
		value?: unknown
	): Promise<unknown> {
		if (this.destroyed) return Promise.reject(new Error("RPC channel destroyed"))
		const id = generateId()
		const transfers: Transferable[] = []
		const message: RPCRequest = { t: "q", id, op, p: path }
		if (args) message.a = this.encodeArgs(args, transfers)
		if (arguments.length >= 4) message.v = this.encodeValue(value, transfers)

		const promise = new Promise<unknown>((resolve, reject) => {
			const pending: PendingRequest = { resolve, reject }
			if (this.timeout > 0) {
				pending.timer = setTimeout(() => {
					this.pending.delete(id)
					const error = new Error(`RPC request ${id} timed out after ${this.timeout}ms`)
					error.name = "RPCTimeoutError"
					reject(error)
				}, this.timeout)
			}
			this.pending.set(id, pending)
		})

		this.post(message, transfers, id)
		return promise
	}

	private post(message: RPCMessage, transfers: Transferable[] = [], pendingId?: string): void {
		try {
			const result = this.transport.send(message, transfers)
			if (result instanceof Promise)
				void result.catch((error) => this.rejectPendingWrite(pendingId, error))
		} catch (error) {
			this.rejectPendingWrite(pendingId, error)
		}
	}

	private rejectPendingWrite(pendingId: string | undefined, error: unknown): void {
		if (!pendingId) return
		const pending = this.pending.get(pendingId)
		if (!pending) return
		this.pending.delete(pendingId)
		if (pending.timer) clearTimeout(pending.timer)
		pending.reject(error instanceof Error ? error : new Error(String(error)))
	}

	private async handleMessage(message: RPCMessage): Promise<void> {
		if (this.destroyed) return
		if (message.t === "r") {
			const pending = this.pending.get(message.id)
			if (!pending) return
			this.pending.delete(message.id)
			if (pending.timer) clearTimeout(pending.timer)
			if (message.e) pending.reject(fromRPCError(message.e))
			else pending.resolve(message.v)
			return
		}
		if (message.t === "cb") {
			const callback = this.callbacks.get(message.id)
			if (callback) void callback(...this.decodeArgs(message.a))
			return
		}
		await this.handleRequest(message)
	}

	private async handleRequest(message: RPCRequest): Promise<void> {
		const transfers: Transferable[] = []
		try {
			const value = await this.executeRequest(message)
			this.post({ t: "r", id: message.id, v: this.encodeValue(value, transfers) }, transfers)
		} catch (error) {
			this.post({ t: "r", id: message.id, e: toRPCError(error) })
		}
	}

	private async executeRequest(message: RPCRequest): Promise<unknown> {
		if (!this.expose) throw new Error("No API exposed")
		if (message.op === "get") return getPath(this.expose, message.p)
		if (message.op === "set") {
			const { parent, key } = getParent(this.expose, message.p)
			Reflect.set(parent, key, message.v)
			return true
		}
		const target = getPath(this.expose, message.p)
		const args = this.decodeArgs(message.a ?? [])
		if (message.op === "new")
			return Reflect.construct(target as new (...args: unknown[]) => unknown, args)
		if (typeof target !== "function") throw new Error(`${message.p.join(".")} is not a function`)
		const receiver = message.p.length > 0 ? getPath(this.expose, message.p.slice(0, -1)) : undefined
		return await Reflect.apply(target, receiver, args)
	}

	private encodeArgs(args: unknown[], transfers: Transferable[]): unknown[] {
		return args.map((arg) => {
			if (typeof arg === "function") {
				const id = generateId()
				this.callbacks.set(id, arg as (...args: unknown[]) => unknown)
				return { [ARG_ENVELOPE_TAG]: "callback", id } satisfies CallbackArgEnvelope
			}
			return {
				[ARG_ENVELOPE_TAG]: "value",
				v: this.encodeValue(arg, transfers)
			} satisfies ValueArgEnvelope
		})
	}

	private decodeArgs(args: unknown[]): unknown[] {
		return args.map((arg) => {
			if (!isArgEnvelope(arg)) return arg
			if (arg[ARG_ENVELOPE_TAG] === "value") return arg.v
			if (arg[ARG_ENVELOPE_TAG] === "callback") {
				const id = arg.id
				return (...callbackArgs: unknown[]) => {
					const transfers: Transferable[] = []
					this.post({ t: "cb", id, a: this.encodeArgs(callbackArgs, transfers) }, transfers)
				}
			}
		})
	}

	private encodeValue(value: unknown, transfers: Transferable[]): unknown {
		const descriptor = this.supportsTransfer ? takeTransferDescriptor(value) : undefined
		if (!descriptor) return value
		transfers.push(...descriptor.transfers)
		return descriptor.value
	}
}
```

Create `packages/kkrpc/src/next/index.ts`:

```ts
import { transfer, type TransferDescriptor } from "../transfer.ts"
import { RPCChannel, type RPCChannelOptions } from "./channel.ts"
import type { RPCMessage } from "./protocol.ts"
import type { Transport } from "./transport.ts"

export { RPCChannel, type RPCChannelOptions }
export { transfer, type TransferDescriptor }
export type {
	RPCCallback,
	RPCError,
	RPCMessage,
	RPCOperation,
	RPCRequest,
	RPCResponse
} from "./protocol.ts"
export type {
	Codec,
	CodecCapabilities,
	Platform,
	PlatformCapabilities,
	Transport,
	TransportCapabilities
} from "./transport.ts"

export interface ExposedController<LocalAPI extends object, RemoteAPI extends object = object> {
	channel: RPCChannel<LocalAPI, RemoteAPI>
	dispose(): void
}

const wrappedChannels = new WeakMap<object, RPCChannel<object, object>>()

export function wrap<RemoteAPI extends object>(
	transport: Transport<RPCMessage>,
	options: Omit<RPCChannelOptions<object>, "expose"> = {}
): RemoteAPI {
	const channel = new RPCChannel<object, RemoteAPI>(transport, options)
	const api = channel.getAPI()
	wrappedChannels.set(api as object, channel as RPCChannel<object, object>)
	return api
}

export function expose<LocalAPI extends object, RemoteAPI extends object = object>(
	api: LocalAPI,
	transport: Transport<RPCMessage>,
	options: Omit<RPCChannelOptions<LocalAPI>, "expose"> = {}
): ExposedController<LocalAPI, RemoteAPI> {
	const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { ...options, expose: api })
	return {
		channel,
		dispose: () => channel.destroy()
	}
}

export function dispose(api: object): void {
	const channel = wrappedChannels.get(api)
	if (!channel) return
	channel.destroy()
	wrappedChannels.delete(api)
}
```

Create `packages/kkrpc/next.ts`:

```ts
/**
 * @module @kunkun/kkrpc/next
 * @description Preview entry for the composable next-generation kkrpc architecture.
 */

export * from "./src/next/index.ts"
```

- [ ] **Step 5: Run core tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-core.test.ts
```

Expected: PASS.

- [ ] **Step 6: Diff checkpoint**

Run from repository root:

```bash
git diff -- packages/kkrpc/__tests__/next-core.test.ts packages/kkrpc/src/next packages/kkrpc/next.ts
```

Expected: New vNext core tests and source only. New untracked files may not appear in `git diff`; if so, report `git status --short`.

---

### Task 2: Transport Composition And Codecs

**Files:**

- Create: `packages/kkrpc/__tests__/next-transport-codecs.test.ts`
- Modify: `packages/kkrpc/src/next/transport.ts`
- Create: `packages/kkrpc/src/next/codecs.ts`
- Create: `packages/kkrpc/next-transport.ts`
- Create: `packages/kkrpc/next-codecs.ts`

- [ ] **Step 1: Write failing transport and codec tests**

Create `packages/kkrpc/__tests__/next-transport-codecs.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { jsonCodec, jsonLineCodec, objectCodec } from "../next-codecs.ts"
import { createTransport, type Platform } from "../next-transport.ts"
import type { RPCMessage } from "../next.ts"

class StringPlatform implements Platform<string> {
	wires: string[] = []
	listener?: (wire: string) => void

	send(wire: string): void {
		this.wires.push(wire)
	}

	subscribe(listener: (wire: string) => void): () => void {
		this.listener = listener
		return () => {
			this.listener = undefined
		}
	}
}

describe("kkrpc/next transport and codecs", () => {
	test("objectCodec passes messages through", () => {
		const codec = objectCodec<RPCMessage>()
		const message: RPCMessage = { t: "q", id: "1", op: "call", p: ["ping"], a: [] }

		expect(codec.encode(message)).toBe(message)
		expect(codec.decode(message)).toBe(message)
		expect(codec.capabilities?.transfer).toBe(true)
	})

	test("jsonCodec encodes strict JSON messages", () => {
		const codec = jsonCodec<RPCMessage>()
		const message: RPCMessage = { t: "q", id: "1", op: "call", p: ["add"], a: [1, 2] }
		const wire = codec.encode(message)

		expect(wire).toBe(JSON.stringify(message))
		expect(codec.decode(wire)).toEqual(message)
		expect(codec.capabilities?.transfer).toBe(false)
	})

	test("jsonCodec rejects non-JSON-safe values through JSON.stringify", () => {
		const codec = jsonCodec<RPCMessage>()
		const message: RPCMessage = { t: "q", id: "1", op: "call", p: ["value"], a: [1n] }

		expect(() => codec.encode(message)).toThrow()
	})

	test("jsonLineCodec adds newline framing", () => {
		const codec = jsonLineCodec<RPCMessage>()
		const message: RPCMessage = { t: "r", id: "1", v: 3 }

		expect(codec.encode(message)).toBe(`${JSON.stringify(message)}\n`)
		expect(codec.decode(`${JSON.stringify(message)}\n`)).toEqual(message)
	})

	test("createTransport composes platform and codec", () => {
		const platform = new StringPlatform()
		const transport = createTransport<RPCMessage, string>({
			platform,
			codec: jsonCodec<RPCMessage>()
		})
		const received: RPCMessage[] = []
		const message: RPCMessage = { t: "q", id: "1", op: "call", p: ["add"], a: [1, 2] }

		const unsubscribe = transport.subscribe((value) => received.push(value))
		transport.send(message)
		expect(platform.wires).toEqual([JSON.stringify(message)])

		platform.listener?.(JSON.stringify(message))
		expect(received).toEqual([message])
		unsubscribe()
		expect(platform.listener).toBeUndefined()
		expect(transport.capabilities?.transfer).toBe(false)
	})
})
```

- [ ] **Step 2: Run failing tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-transport-codecs.test.ts
```

Expected: FAIL because `next-transport.ts` and `next-codecs.ts` do not exist.

- [ ] **Step 3: Implement `createTransport`**

Append to `packages/kkrpc/src/next/transport.ts`:

```ts
export function createTransport<TMessage, TWire>(options: {
	platform: Platform<TWire>
	codec: Codec<TMessage, TWire>
}): Transport<TMessage> {
	const { platform, codec } = options
	return {
		capabilities: {
			objectMode: platform.capabilities?.objectMode,
			transfer: platform.capabilities?.transfer === true && codec.capabilities?.transfer === true
		},
		send(message, transfers = []) {
			const wire = codec.encode(message)
			return platform.send(
				wire,
				platform.capabilities?.transfer === true && codec.capabilities?.transfer === true
					? transfers
					: []
			)
		},
		subscribe(listener) {
			return platform.subscribe((wire) => listener(codec.decode(wire)))
		},
		close() {
			platform.close?.()
		}
	}
}
```

- [ ] **Step 4: Implement codecs and entries**

Create `packages/kkrpc/src/next/codecs.ts`:

```ts
import type { Codec } from "./transport.ts"

export function objectCodec<TMessage>(): Codec<TMessage, TMessage> {
	return {
		capabilities: { transfer: true },
		encode: (message) => message,
		decode: (wire) => wire
	}
}

export function jsonCodec<TMessage>(): Codec<TMessage, string> {
	return {
		capabilities: { transfer: false },
		encode: (message) => JSON.stringify(message),
		decode: (wire) => JSON.parse(wire) as TMessage
	}
}

export function jsonLineCodec<TMessage>(): Codec<TMessage, string> {
	const json = jsonCodec<TMessage>()
	return {
		capabilities: { transfer: false },
		encode: (message) => `${json.encode(message)}\n`,
		decode: (wire) => json.decode(wire.trimEnd())
	}
}
```

Create `packages/kkrpc/next-transport.ts`:

```ts
/**
 * @module @kunkun/kkrpc/next/transport
 * @description Transport composition utilities for kkrpc/next.
 */

export * from "./src/next/transport.ts"
```

Create `packages/kkrpc/next-codecs.ts`:

```ts
/**
 * @module @kunkun/kkrpc/next/codecs
 * @description Wire codecs for kkrpc/next transports.
 */

export * from "./src/next/codecs.ts"
```

- [ ] **Step 5: Run transport and codec tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-transport-codecs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run core tests again**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-core.test.ts
```

Expected: PASS.

---

### Task 3: Worker Object Transport Presets

**Files:**

- Create: `packages/kkrpc/src/next/worker.ts`
- Create: `packages/kkrpc/next-worker.ts`
- Create: `packages/kkrpc/__tests__/next-worker.test.ts`
- Create: `packages/kkrpc/__tests__/scripts/next-worker.ts`

- [ ] **Step 1: Write failing worker preset tests and fixture**

Create `packages/kkrpc/__tests__/scripts/next-worker.ts`:

```ts
import { workerSelfTransport } from "../../next-worker.ts"
import { expose, transfer } from "../../next.ts"

const api = {
	add: async (a: number, b: number) => a + b,
	takeBuffer: async (buffer: ArrayBuffer) => buffer.byteLength,
	createBuffer: async (size: number) => {
		const buffer = new ArrayBuffer(size)
		return transfer(buffer, [buffer])
	}
}

expose(api, workerSelfTransport())
```

Create `packages/kkrpc/__tests__/next-worker.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { workerTransport } from "../next-worker.ts"
import { dispose, transfer, wrap } from "../next.ts"

interface WorkerAPI {
	add(a: number, b: number): Promise<number>
	takeBuffer(buffer: ArrayBuffer): Promise<number>
	createBuffer(size: number): Promise<ArrayBuffer>
}

function createWorkerApi() {
	const worker = new Worker(new URL("./scripts/next-worker.ts", import.meta.url).href, {
		type: "module"
	})
	const api = wrap<WorkerAPI>(workerTransport(worker))
	return { api, worker }
}

describe("kkrpc/next worker presets", () => {
	test("wraps a worker object transport", async () => {
		const { api } = createWorkerApi()

		try {
			expect(await api.add(2, 3)).toBe(5)
		} finally {
			dispose(api)
		}
	})

	test("supports transfer over worker object transport", async () => {
		const { api } = createWorkerApi()
		const buffer = new ArrayBuffer(16)

		try {
			expect(await api.takeBuffer(transfer(buffer, [buffer]))).toBe(16)
			expect(buffer.byteLength).toBe(0)
			const remoteBuffer = await api.createBuffer(32)
			expect(remoteBuffer).toBeInstanceOf(ArrayBuffer)
			expect(remoteBuffer.byteLength).toBe(32)
		} finally {
			dispose(api)
		}
	})
})
```

- [ ] **Step 2: Run failing worker tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-worker.test.ts
```

Expected: FAIL because `next-worker.ts` does not exist.

- [ ] **Step 3: Implement worker transports and entry**

Create `packages/kkrpc/src/next/worker.ts`:

```ts
import type { RPCMessage } from "./protocol.ts"
import type { Transport } from "./transport.ts"

type MessageTargetLike = {
	postMessage(message: RPCMessage, transfer?: Transferable[]): void
	addEventListener(type: "message", listener: (event: MessageEvent) => void): void
	removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
}

type WorkerScopeLike = MessageTargetLike & {
	close?(): void
}

export function workerTransport(worker: Worker): Transport<RPCMessage> {
	return {
		capabilities: { objectMode: true, transfer: true },
		send(message, transfers = []) {
			if (transfers.length > 0) worker.postMessage(message, transfers)
			else worker.postMessage(message)
		},
		subscribe(listener) {
			const handler = (event: MessageEvent) => listener(event.data as RPCMessage)
			worker.addEventListener("message", handler)
			return () => worker.removeEventListener("message", handler)
		},
		close() {
			worker.terminate()
		}
	}
}

export function workerSelfTransport(
	scope: WorkerScopeLike = globalThis as unknown as WorkerScopeLike
): Transport<RPCMessage> {
	return {
		capabilities: { objectMode: true, transfer: true },
		send(message, transfers = []) {
			if (transfers.length > 0) scope.postMessage(message, transfers)
			else scope.postMessage(message)
		},
		subscribe(listener) {
			const handler = (event: MessageEvent) => listener(event.data as RPCMessage)
			scope.addEventListener("message", handler)
			return () => scope.removeEventListener("message", handler)
		},
		close() {
			scope.close?.()
		}
	}
}
```

Create `packages/kkrpc/next-worker.ts`:

```ts
/**
 * @module @kunkun/kkrpc/next/worker
 * @description Worker object-mode transports for kkrpc/next.
 */

export * from "./src/next/worker.ts"
```

- [ ] **Step 4: Run worker tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-worker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run core and codec tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-core.test.ts __tests__/next-transport-codecs.test.ts
```

Expected: PASS.

---

### Task 4: Stdio JSON Transport With Explicit Stream Pairs

**Files:**

- Create: `packages/kkrpc/src/next/stdio.ts`
- Create: `packages/kkrpc/next-stdio.ts`
- Create: `packages/kkrpc/__tests__/next-stdio.test.ts`

- [ ] **Step 1: Write failing stdio tests**

Create `packages/kkrpc/__tests__/next-stdio.test.ts`:

```ts
import { PassThrough } from "node:stream"
import { describe, expect, test } from "bun:test"
import { stdioJsonTransport } from "../next-stdio.ts"
import { dispose, expose, wrap } from "../next.ts"

interface API {
	add(a: number, b: number): Promise<number>
	callCallback(value: number, callback: (value: number) => void): Promise<void>
}

function createStreamPair() {
	const clientToServer = new PassThrough()
	const serverToClient = new PassThrough()
	return {
		client: { readable: serverToClient, writable: clientToServer },
		server: { readable: clientToServer, writable: serverToClient }
	}
}

describe("kkrpc/next stdio JSON transport", () => {
	test("supports explicit readable/writable stream pairs", async () => {
		const streams = createStreamPair()
		const apiImpl: API = {
			add: async (a, b) => a + b,
			callCallback: async (value, callback) => callback(value + 1)
		}
		const controller = expose(apiImpl, stdioJsonTransport(streams.server))
		const api = wrap<API>(stdioJsonTransport(streams.client))

		try {
			expect(await api.add(2, 6)).toBe(8)
			let completeCall: Promise<void> | undefined
			const callbackResult = new Promise<number>((resolve) => {
				completeCall = api.callCallback(4, resolve)
			})
			expect(await callbackResult).toBe(5)
			await completeCall
		} finally {
			dispose(api)
			controller.dispose()
		}
	})

	test("supports multiple independent stream pairs", async () => {
		const first = createStreamPair()
		const second = createStreamPair()
		const controllerA = expose(
			{ add: async (a: number, b: number) => a + b },
			stdioJsonTransport(first.server)
		)
		const controllerB = expose(
			{ add: async (a: number, b: number) => a * b },
			stdioJsonTransport(second.server)
		)
		const apiA = wrap<{ add(a: number, b: number): Promise<number> }>(
			stdioJsonTransport(first.client)
		)
		const apiB = wrap<{ add(a: number, b: number): Promise<number> }>(
			stdioJsonTransport(second.client)
		)

		try {
			expect(await apiA.add(2, 3)).toBe(5)
			expect(await apiB.add(2, 3)).toBe(6)
		} finally {
			dispose(apiA)
			dispose(apiB)
			controllerA.dispose()
			controllerB.dispose()
		}
	})
})
```

- [ ] **Step 2: Run failing stdio tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-stdio.test.ts
```

Expected: FAIL because `next-stdio.ts` does not exist.

- [ ] **Step 3: Implement stdio JSON transport and entry**

Create `packages/kkrpc/src/next/stdio.ts`:

```ts
import { jsonLineCodec } from "./codecs.ts"
import type { RPCMessage } from "./protocol.ts"
import { createTransport, type Platform, type Transport } from "./transport.ts"

export interface ReadableLike {
	on(event: "data", listener: (chunk: Uint8Array | string) => void): this
	on(event: "end", listener: () => void): this
	on(event: "error", listener: (error: Error) => void): this
	off?(event: "data" | "end" | "error", listener: Function): this
}

export interface WritableLike {
	write(chunk: string, callback?: (error?: Error | null) => void): unknown
	end?(): void
}

export interface StdioPlatformOptions {
	readable: ReadableLike
	writable: WritableLike
}

export function stdioPlatform(options: StdioPlatformOptions): Platform<string> {
	const { readable, writable } = options
	return {
		capabilities: { objectMode: false, transfer: false },
		send(wire) {
			return new Promise<void>((resolve, reject) => {
				try {
					writable.write(wire, (error?: Error | null) => {
						if (error) reject(error)
						else resolve()
					})
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)))
				}
			})
		},
		subscribe(listener) {
			let buffer = ""
			const onData = (chunk: Uint8Array | string) => {
				buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
				while (true) {
					const index = buffer.indexOf("\n")
					if (index < 0) break
					const line = buffer.slice(0, index + 1)
					buffer = buffer.slice(index + 1)
					if (line.trim().length > 0) listener(line)
				}
			}
			readable.on("data", onData)
			return () => readable.off?.("data", onData)
		},
		close() {
			writable.end?.()
		}
	}
}

export function stdioJsonTransport(options: StdioPlatformOptions): Transport<RPCMessage> {
	return createTransport({ platform: stdioPlatform(options), codec: jsonLineCodec<RPCMessage>() })
}

export function nodeStdioTransport(options?: Partial<StdioPlatformOptions>): Transport<RPCMessage> {
	return stdioJsonTransport({
		readable: options?.readable ?? process.stdin,
		writable: options?.writable ?? process.stdout
	})
}
```

Create `packages/kkrpc/next-stdio.ts`:

```ts
/**
 * @module @kunkun/kkrpc/next/stdio
 * @description Stdio JSON transports for kkrpc/next.
 */

export * from "./src/next/stdio.ts"
```

- [ ] **Step 4: Run stdio tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-stdio.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all next focused tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-core.test.ts __tests__/next-transport-codecs.test.ts __tests__/next-worker.test.ts __tests__/next-stdio.test.ts
```

Expected: PASS.

---

### Task 5: Package Exports, Build Entries, And Benchmarks

**Files:**

- Modify: `packages/kkrpc/package.json`
- Modify: `packages/kkrpc/tsdown.config.ts`
- Modify: `packages/kkrpc/scripts/compare-browser-bundle-size.ts`
- Modify: `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts`

- [ ] **Step 1: Add failing benchmark expectations for vNext**

In `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts`, update the benchmark case test expected names to include vNext browser-relevant cases before `browser-mini`:

```ts
expect(cases.map((entry) => entry.name)).toEqual([
	"kkrpc/browser",
	"kkrpc/browser-lite",
	"kkrpc/next",
	"kkrpc/next/worker",
	"kkrpc/browser-mini",
	"kkrpc-lite direct",
	"comctx"
])
expect(cases[2]?.source).toContain('from "kkrpc/next"')
expect(cases[3]?.source).toContain('from "kkrpc/next/worker"')
expect(cases[4]?.source).toContain('from "kkrpc/browser-mini"')
expect(cases[5]?.source).toContain("src/channel-lite.ts")
expect(cases[6]?.source).toContain("comctx-local/index.ts")
```

Add helper samples in the script implementation step below; the initial test run should fail.

- [ ] **Step 2: Run failing benchmark helper tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: FAIL because vNext benchmark cases are not present yet.

- [ ] **Step 3: Add package exports**

In `packages/kkrpc/package.json`, add exports after `./browser-mini`:

```json
		"./next": {
			"import": { "types": "./dist/next.d.ts", "default": "./dist/next.js" },
			"require": { "types": "./dist/next.d.cts", "default": "./dist/next.cjs" }
		},
		"./next/worker": {
			"import": { "types": "./dist/next-worker.d.ts", "default": "./dist/next-worker.js" },
			"require": { "types": "./dist/next-worker.d.cts", "default": "./dist/next-worker.cjs" }
		},
		"./next/stdio": {
			"import": { "types": "./dist/next-stdio.d.ts", "default": "./dist/next-stdio.js" },
			"require": { "types": "./dist/next-stdio.d.cts", "default": "./dist/next-stdio.cjs" }
		},
		"./next/transport": {
			"import": { "types": "./dist/next-transport.d.ts", "default": "./dist/next-transport.js" },
			"require": { "types": "./dist/next-transport.d.cts", "default": "./dist/next-transport.cjs" }
		},
		"./next/codecs": {
			"import": { "types": "./dist/next-codecs.d.ts", "default": "./dist/next-codecs.js" },
			"require": { "types": "./dist/next-codecs.d.cts", "default": "./dist/next-codecs.cjs" }
		},
```

In `packages/kkrpc/tsdown.config.ts`, add entries after `./browser-mini-mod.ts`:

```ts
		"./next.ts",
		"./next-worker.ts",
		"./next-stdio.ts",
		"./next-transport.ts",
		"./next-codecs.ts",
```

- [ ] **Step 4: Add vNext benchmark cases**

In `packages/kkrpc/scripts/compare-browser-bundle-size.ts`, add cases after `kkrpc/browser-lite`:

```ts
		{
			name: "kkrpc/next",
			fileName: "kkrpc-next.ts",
			source: createKkrpcNextCoreSample("kkrpc/next")
		},
		{
			name: "kkrpc/next/worker",
			fileName: "kkrpc-next-worker.ts",
			source: createKkrpcNextWorkerSample("kkrpc/next", "kkrpc/next/worker")
		},
```

Add sample helpers near `createKkrpcPublicSample`:

```ts
function createKkrpcNextCoreSample(importPath: string): string {
	return `import { RPCChannel, type Transport, type RPCMessage } from "${importPath}"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}

export function createRPC(transport: Transport<RPCMessage>) {
	const channel = new RPCChannel<{}, RemoteAPI>(transport)
	return channel.getAPI()
}

Object.assign(globalThis, { createRPC })
`
}

function createKkrpcNextWorkerSample(coreImport: string, workerImport: string): string {
	return `import { wrap } from "${coreImport}"
import { workerTransport } from "${workerImport}"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}

export function createRPC(worker: Worker) {
	return wrap<RemoteAPI>(workerTransport(worker))
}

Object.assign(globalThis, { createRPC })
`
}
```

- [ ] **Step 5: Run benchmark helper tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck and focused tests**

Run from repository root:

```bash
pnpm --filter kkrpc check-types
```

Expected: PASS.

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-core.test.ts __tests__/next-transport-codecs.test.ts __tests__/next-worker.test.ts __tests__/next-stdio.test.ts __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: PASS.

---

### Task 6: Final Verification And Bundle Comparison

**Files:**

- No source file edits unless verification exposes a bug.

- [ ] **Step 1: Run focused vNext tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-core.test.ts __tests__/next-transport-codecs.test.ts __tests__/next-worker.test.ts __tests__/next-stdio.test.ts
bun test __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck and bundle guards**

Run from repository root:

```bash
pnpm --filter kkrpc check-types
pnpm --filter kkrpc check:browser-lite-bundle
```

Expected: PASS.

- [ ] **Step 3: Run bundle comparison**

Run from repository root:

```bash
pnpm --filter kkrpc compare:browser-bundle-size
```

Expected: PASS and output includes rows for:

```text
kkrpc/next
kkrpc/next/worker
kkrpc/browser-mini
kkrpc/browser-lite
comctx
```

Inspect contributor tables. `kkrpc/next` and `kkrpc/next/worker` must not include:

```text
src/channel-core.ts
src/validation.ts
src/middleware.ts
src/serialization-full.ts
src/serialization-json.ts
src/transfer-handlers.ts
src/adapters/worker.ts
```

- [ ] **Step 4: Final status checkpoint**

Run from repository root:

```bash
git status --short
git diff --stat
```

Expected: No `dist/` edits and no generated docs edits. Existing unrelated workspace changes may still be present; do not revert them.

---

## Self-Review Notes

- Spec coverage: Tasks cover `kkrpc/next`, `RPCChannel`, `wrap`, `expose`, `dispose`, transport/platform/codec types, `createTransport`, object/json/json-line codecs, worker presets, explicit stdio stream pairs, Node shortcut, exports, build entries, tests, and benchmarks.
- Deferred scope: Chrome extension, WebSocket, Deno/Bun shortcuts, validation, middleware, streaming, metadata, SuperJSON, transfer handlers, and broadcast remain deferred as specified.
- API consistency: The plan uses `Transport.send/subscribe/close`, `Platform.send/subscribe/close`, and `Codec.encode/decode` consistently across tasks.
- Shorthand constraints: `wrap()` hides its channel behind `dispose(api)`, while `expose()` returns only `ExposedController`; bidirectional users use `RPCChannel` directly.
- Stdio flexibility: The plan requires `stdioJsonTransport({ readable, writable })`, so multiple child processes are first-class and runtime defaults are only shortcuts.
