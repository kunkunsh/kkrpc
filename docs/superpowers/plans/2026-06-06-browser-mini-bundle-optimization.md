# Browser Mini Bundle Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact `kkrpc/browser-mini` browser entry that preserves common proxy RPC ergonomics while avoiding the full browser channel and adapter bundle costs.

**Architecture:** Build a separate worker-only mini stack under `src/browser-mini/` with a small structured-clone message protocol, event-based worker transports, and a compact `RPCChannel`. Keep `kkrpc/browser` and `kkrpc/browser-lite` unchanged. Extend the existing browser bundle benchmark to include the mini entry and verify it does not import `src/channel-core.ts`.

**Tech Stack:** TypeScript, Bun test runner, Bun bundler metafiles, tsdown package build, browser Worker structured clone.

**Execution Note:** Commit steps are intentionally replaced with diff review checkpoints because this workspace must not commit unless the user explicitly requests it.

---

## File Structure

- Create: `packages/kkrpc/src/browser-mini/types.ts`
- Responsibility: Mini protocol and transport types only. No runtime imports.

- Create: `packages/kkrpc/src/browser-mini/worker.ts`
- Responsibility: Tiny `WorkerParentIO` and `WorkerChildIO` transports for structured-clone messages and transfer lists.

- Create: `packages/kkrpc/src/browser-mini/channel.ts`
- Responsibility: Compact request/response/callback/proxy state machine for the mini entry.

- Create: `packages/kkrpc/browser-mini-mod.ts`
- Responsibility: Public `kkrpc/browser-mini` source entry.

- Create: `packages/kkrpc/__tests__/browser-mini.test.ts`
- Responsibility: Focused integration tests for call, nested path, callback, get, set, constructor, transfer, timeout, and destroy behavior.

- Create: `packages/kkrpc/__tests__/scripts/browser-mini-worker.ts`
- Responsibility: Real Bun worker fixture exposing the mini test API through `WorkerChildIO`.

- Modify: `packages/kkrpc/package.json`
- Responsibility: Add `./browser-mini` export.

- Modify: `packages/kkrpc/tsdown.config.ts`
- Responsibility: Add `./browser-mini-mod.ts` build entry.

- Modify: `packages/kkrpc/scripts/compare-browser-bundle-size.ts`
- Responsibility: Add the `kkrpc/browser-mini` benchmark case.

- Modify: `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts`
- Responsibility: Update expected benchmark case list and import assertions.

---

### Task 1: Add Browser-Mini Benchmark Case Tests

**Files:**
- Modify: `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts:77-98`

- [ ] **Step 1: Write the failing benchmark helper assertion**

Replace the `creates benchmark cases with public, direct, and comctx entries` test with:

```ts
	test("creates benchmark cases with public, mini, direct, and comctx entries", () => {
		const cases = createBenchmarkCases({
			packageRoot: "/repo/packages/kkrpc",
			repoRoot: "/repo",
			workDir: "/repo/packages/kkrpc/.browser-bundle-benchmark",
			comctxEntrypoint: "/repo/packages/kkrpc/.browser-bundle-benchmark/comctx-local/index.ts"
		})

		expect(cases.map((entry) => entry.name)).toEqual([
			"kkrpc/browser",
			"kkrpc/browser-lite",
			"kkrpc/browser-mini",
			"kkrpc-lite direct",
			"comctx"
		])
		expect(cases[0]?.source).toContain('from "kkrpc/browser"')
		expect(cases[1]?.source).toContain('from "kkrpc/browser-lite"')
		expect(cases[2]?.source).toContain('from "kkrpc/browser-mini"')
		expect(cases[3]?.source).toContain("src/channel-lite.ts")
		expect(cases[4]?.source).toContain("comctx-local/index.ts")
		for (const entry of cases) {
			expect(entry.source).toContain("Object.assign(globalThis")
		}
	})
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: FAIL because `createBenchmarkCases()` still returns four entries and does not include `kkrpc/browser-mini`.

- [ ] **Step 3: Add the benchmark case**

In `packages/kkrpc/scripts/compare-browser-bundle-size.ts`, insert the mini case after `kkrpc/browser-lite`:

```ts
		{
			name: "kkrpc/browser-mini",
			fileName: "kkrpc-browser-mini.ts",
			source: createKkrpcPublicSample("kkrpc/browser-mini")
		},
```

The full `cases` array should be:

```ts
	const cases: Array<{ name: string; fileName: string; source: string }> = [
		{
			name: "kkrpc/browser",
			fileName: "kkrpc-browser.ts",
			source: createKkrpcPublicSample("kkrpc/browser")
		},
		{
			name: "kkrpc/browser-lite",
			fileName: "kkrpc-browser-lite.ts",
			source: createKkrpcPublicSample("kkrpc/browser-lite")
		},
		{
			name: "kkrpc/browser-mini",
			fileName: "kkrpc-browser-mini.ts",
			source: createKkrpcPublicSample("kkrpc/browser-mini")
		},
		{
			name: "kkrpc-lite direct",
			fileName: "kkrpc-lite-direct.ts",
			source: createKkrpcDirectSample(directChannelImport, directInterfaceImport)
		},
		{
			name: "comctx",
			fileName: "comctx.ts",
			source: createComctxSample(comctxImport)
		}
	]
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: PASS.

- [ ] **Step 5: Review the diff checkpoint**

Run from the repository root:

```bash
git diff -- packages/kkrpc/scripts/compare-browser-bundle-size.ts packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts
```

Expected: Diff only contains the new benchmark case and updated test expectations.

---

### Task 2: Add Browser-Mini Integration Tests And Worker Fixture

**Files:**
- Create: `packages/kkrpc/__tests__/browser-mini.test.ts`
- Create: `packages/kkrpc/__tests__/scripts/browser-mini-worker.ts`

- [ ] **Step 1: Add the worker fixture**

Create `packages/kkrpc/__tests__/scripts/browser-mini-worker.ts`:

```ts
import { RPCChannel, transfer, WorkerChildIO } from "../../browser-mini-mod.ts"

const config = { name: "initial" }

class Widget {
	name: string

	constructor(name: string) {
		this.name = name
	}
}

const api = {
	math: {
		add: async (a: number, b: number) => a + b,
		nested: {
			multiply: async (a: number, b: number) => a * b
		}
	},
	callCallback: async (value: number, callback: (value: number) => void) => {
		callback(value + 1)
	},
	config,
	Widget,
	takeBuffer: async (buffer: ArrayBuffer) => buffer.byteLength,
	createBuffer: async (size: number) => {
		const buffer = new ArrayBuffer(size)
		return transfer(buffer, [buffer])
	},
	hang: async () => new Promise(() => {})
}

new RPCChannel<typeof api, Record<string, never>>(new WorkerChildIO(), { expose: api })
```

- [ ] **Step 2: Add the failing integration tests**

Create `packages/kkrpc/__tests__/browser-mini.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { RPCChannel, transfer, WorkerParentIO } from "../browser-mini-mod.ts"

interface RemoteWidget {
	name: string
}

interface RemoteAPI {
	math: {
		add(a: number, b: number): Promise<number>
		nested: {
			multiply(a: number, b: number): Promise<number>
		}
	}
	callCallback(value: number, callback: (value: number) => void): Promise<void>
	config: {
		name: string
	}
	Widget: new (name: string) => Promise<RemoteWidget>
	takeBuffer(buffer: ArrayBuffer): Promise<number>
	createBuffer(size: number): Promise<ArrayBuffer>
	hang(): Promise<void>
}

function createRpc(timeout = 1000) {
	const worker = new Worker(new URL("./scripts/browser-mini-worker.ts", import.meta.url).href, {
		type: "module"
	})
	const rpc = new RPCChannel<Record<string, never>, RemoteAPI>(new WorkerParentIO(worker), {
		timeout
	})
	const api = rpc.getAPI()
	return { api, rpc }
}

describe("browser-mini RPCChannel", () => {
	test("calls remote methods and nested paths", async () => {
		const { api, rpc } = createRpc()

		try {
			expect(await api.math.add(2, 5)).toBe(7)
			expect(await api.math.nested.multiply(3, 4)).toBe(12)
		} finally {
			rpc.destroy()
		}
	})

	test("invokes callback arguments", async () => {
		const { api, rpc } = createRpc()

		try {
			const callbackValue = await new Promise<number>((resolve) => {
				void api.callCallback(9, resolve)
			})
			expect(callbackValue).toBe(10)
		} finally {
			rpc.destroy()
		}
	})

	test("gets and sets remote properties", async () => {
		const { api, rpc } = createRpc()

		try {
			expect(await api.config.name).toBe("initial")
			api.config.name = "updated"
			await new Promise((resolve) => setTimeout(resolve, 20))
			expect(await api.config.name).toBe("updated")
		} finally {
			rpc.destroy()
		}
	})

	test("calls remote constructors", async () => {
		const { api, rpc } = createRpc()

		try {
			const widget = await new api.Widget("demo")
			expect(widget).toEqual({ name: "demo" })
		} finally {
			rpc.destroy()
		}
	})

	test("transfers marked top-level ArrayBuffers", async () => {
		const { api, rpc } = createRpc()
		const buffer = new ArrayBuffer(16)

		try {
			expect(await api.takeBuffer(transfer(buffer, [buffer]))).toBe(16)
			expect(buffer.byteLength).toBe(0)

			const remoteBuffer = await api.createBuffer(32)
			expect(remoteBuffer).toBeInstanceOf(ArrayBuffer)
			expect(remoteBuffer.byteLength).toBe(32)
		} finally {
			rpc.destroy()
		}
	})

	test("rejects timed out requests", async () => {
		const { api, rpc } = createRpc(10)

		try {
			await expect(api.hang()).rejects.toThrow("timed out after 10ms")
		} finally {
			rpc.destroy()
		}
	})

	test("rejects pending requests on destroy", async () => {
		const { api, rpc } = createRpc()
		const pending = api.hang()

		rpc.destroy()

		await expect(pending).rejects.toThrow("RPC channel destroyed")
	})
})
```

- [ ] **Step 3: Run the integration tests to verify they fail**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-mini.test.ts
```

Expected: FAIL because `browser-mini-mod.ts`, `src/browser-mini/channel.ts`, and `src/browser-mini/worker.ts` do not exist yet.

- [ ] **Step 4: Review the diff checkpoint**

Run from the repository root:

```bash
git diff -- packages/kkrpc/__tests__/browser-mini.test.ts packages/kkrpc/__tests__/scripts/browser-mini-worker.ts
```

Expected: Diff only contains the new test and worker fixture.

---

### Task 3: Implement Mini Types, Worker Transports, Channel, And Source Entry

**Files:**
- Create: `packages/kkrpc/src/browser-mini/types.ts`
- Create: `packages/kkrpc/src/browser-mini/worker.ts`
- Create: `packages/kkrpc/src/browser-mini/channel.ts`
- Create: `packages/kkrpc/browser-mini-mod.ts`

- [ ] **Step 1: Add protocol and transport types**

Create `packages/kkrpc/src/browser-mini/types.ts`:

```ts
export interface MiniError {
	n: string
	m: string
	s?: string
}

export type MiniOperation = "call" | "get" | "set" | "new"

export interface MiniRequest {
	t: "q"
	id: string
	op: MiniOperation
	p: string[]
	a?: unknown[]
	v?: unknown
}

export interface MiniResponse {
	t: "r"
	id: string
	v?: unknown
	e?: MiniError
}

export interface MiniCallback {
	t: "cb"
	id: string
	a: unknown[]
}

export type MiniMessage = MiniRequest | MiniResponse | MiniCallback

export interface MiniTransport {
	post(message: MiniMessage, transfers?: Transferable[]): void | Promise<void>
	onMessage(listener: (message: MiniMessage) => void): () => void
	destroy?(): void
	canTransfer?: boolean
}
```

- [ ] **Step 2: Add worker transports**

Create `packages/kkrpc/src/browser-mini/worker.ts`:

```ts
import type { MiniMessage, MiniTransport } from "./types.ts"

type MessageTargetLike = {
	postMessage(message: MiniMessage, transfer?: Transferable[]): void
	addEventListener(type: "message", listener: (event: MessageEvent) => void): void
	removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
}

type WorkerScopeLike = MessageTargetLike & {
	close?(): void
}

export class WorkerParentIO implements MiniTransport {
	canTransfer = true

	constructor(private worker: Worker) {}

	post(message: MiniMessage, transfers: Transferable[] = []): void {
		if (transfers.length > 0) {
			this.worker.postMessage(message, transfers)
			return
		}
		this.worker.postMessage(message)
	}

	onMessage(listener: (message: MiniMessage) => void): () => void {
		const handler = (event: MessageEvent) => listener(event.data as MiniMessage)
		this.worker.addEventListener("message", handler)
		return () => this.worker.removeEventListener("message", handler)
	}

	destroy(): void {
		this.worker.terminate()
	}
}

export class WorkerChildIO implements MiniTransport {
	canTransfer = true
	private scope: WorkerScopeLike

	constructor(scope: WorkerScopeLike = globalThis as unknown as WorkerScopeLike) {
		this.scope = scope
	}

	post(message: MiniMessage, transfers: Transferable[] = []): void {
		if (transfers.length > 0) {
			this.scope.postMessage(message, transfers)
			return
		}
		this.scope.postMessage(message)
	}

	onMessage(listener: (message: MiniMessage) => void): () => void {
		const handler = (event: MessageEvent) => listener(event.data as MiniMessage)
		this.scope.addEventListener("message", handler)
		return () => this.scope.removeEventListener("message", handler)
	}

	destroy(): void {
		this.scope.close?.()
	}
}
```

- [ ] **Step 3: Add the compact channel**

Create `packages/kkrpc/src/browser-mini/channel.ts`:

```ts
import { takeTransferDescriptor } from "../transfer.ts"
import type {
	MiniError,
	MiniMessage,
	MiniOperation,
	MiniRequest,
	MiniResponse,
	MiniTransport
} from "./types.ts"

export type { MiniMessage, MiniTransport } from "./types.ts"

export interface RPCChannelOptions<LocalAPI extends Record<string, unknown>> {
	expose?: LocalAPI
	timeout?: number
	enableTransfer?: boolean
}

type PendingRequest = {
	resolve: (value: unknown) => void
	reject: (error: Error) => void
	timer?: ReturnType<typeof setTimeout>
}

type CallbackFunction = (...args: unknown[]) => void

const CALLBACK_KEY = "__kkrpcMiniCallback" as const

interface CallbackRef {
	[CALLBACK_KEY]: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && (typeof value === "object" || typeof value === "function")
}

function isCallbackRef(value: unknown): value is CallbackRef {
	return isRecord(value) && typeof value[CALLBACK_KEY] === "string"
}

function toMiniError(error: unknown): MiniError {
	if (error instanceof Error) {
		return { n: error.name, m: error.message, s: error.stack }
	}
	return { n: "Error", m: String(error) }
}

function fromMiniError(error: MiniError): Error {
	const restored = new Error(error.m)
	restored.name = error.n
	if (error.s) restored.stack = error.s
	return restored
}

function timeoutError(path: string[], timeout: number): Error {
	const error = new Error(`RPC call to "${path.join(".")}" timed out after ${timeout}ms`)
	error.name = "RPCTimeoutError"
	return error
}

export class RPCChannel<
	LocalAPI extends Record<string, unknown>,
	RemoteAPI extends Record<string, unknown>,
	Transport extends MiniTransport = MiniTransport
> {
	private apiImplementation?: LocalAPI
	private pending = new Map<string, PendingRequest>()
	private callbacks = new Map<string, CallbackFunction>()
	private callbackIds = new WeakMap<CallbackFunction, string>()
	private nextId = 0
	private timeout: number
	private supportsTransfer: boolean
	private offMessage?: () => void
	private destroyed = false

	constructor(
		private transport: Transport,
		options?: RPCChannelOptions<LocalAPI>
	) {
		this.apiImplementation = options?.expose
		this.timeout = options?.timeout ?? 0
		this.supportsTransfer = options?.enableTransfer !== false && transport.canTransfer === true
		this.offMessage = transport.onMessage((message) => {
			void this.handleMessage(message)
		})
	}

	expose(api: LocalAPI): void {
		this.apiImplementation = api
	}

	getAPI(): RemoteAPI {
		return this.createNestedProxy([]) as RemoteAPI
	}

	destroy(): void {
		if (this.destroyed) return
		this.destroyed = true
		this.offMessage?.()
		this.offMessage = undefined

		const error = new Error("RPC channel destroyed")
		for (const [id, pending] of this.pending) {
			if (pending.timer) clearTimeout(pending.timer)
			pending.reject(error)
			this.pending.delete(id)
		}

		this.callbacks.clear()
		this.callbackIds = new WeakMap<CallbackFunction, string>()
		this.transport.destroy?.()
	}

	private nextMessageId(): string {
		this.nextId += 1
		return `${Date.now().toString(36)}-${this.nextId.toString(36)}`
	}

	private async handleMessage(message: MiniMessage): Promise<void> {
		if (this.destroyed) return
		if (message.t === "q") {
			await this.handleRequest(message)
			return
		}
		if (message.t === "r") {
			this.handleResponse(message)
			return
		}
		this.handleCallback(message.id, message.a)
	}

	private async handleRequest(message: MiniRequest): Promise<void> {
		try {
			const result = await this.invokeLocal(message)
			this.sendResponse(message.id, result)
		} catch (error) {
			this.sendResponse(message.id, undefined, toMiniError(error))
		}
	}

	private handleResponse(message: MiniResponse): void {
		const pending = this.pending.get(message.id)
		if (!pending) return

		if (pending.timer) clearTimeout(pending.timer)
		this.pending.delete(message.id)

		if (message.e) {
			pending.reject(fromMiniError(message.e))
			return
		}

		pending.resolve(message.v)
	}

	private async invokeLocal(message: MiniRequest): Promise<unknown> {
		if (!this.apiImplementation) {
			throw new Error("No API implementation available")
		}

		if (message.op === "get") {
			return this.resolveValue(this.apiImplementation, message.p)
		}

		if (message.op === "set") {
			const { target, key } = this.resolveParent(this.apiImplementation, message.p)
			target[key] = message.v
			return true
		}

		if (message.op === "new") {
			const constructor = this.resolveValue(this.apiImplementation, message.p)
			if (typeof constructor !== "function") {
				throw new Error(`Constructor ${message.p.join(".")} is not a function`)
			}
			return Reflect.construct(constructor, this.restoreIncomingArgs(message.a ?? []))
		}

		const { target, key } = this.resolveParent(this.apiImplementation, message.p)
		const method = target[key]
		if (typeof method !== "function") {
			throw new Error(`Method ${message.p.join(".")} is not a function`)
		}

		return await method.apply(target, this.restoreIncomingArgs(message.a ?? []))
	}

	private resolveValue(root: unknown, path: string[]): unknown {
		let current = root
		for (const key of path) {
			if (!isRecord(current) || !(key in current)) {
				throw new Error(`Path ${path.join(".")} not found at ${key}`)
			}
			current = current[key]
		}
		return current
	}

	private resolveParent(root: unknown, path: string[]): { target: Record<string, unknown>; key: string } {
		const key = path.at(-1)
		if (!key) throw new Error("Invalid empty path")

		const target = this.resolveValue(root, path.slice(0, -1))
		if (!isRecord(target)) {
			throw new Error(`Path ${path.slice(0, -1).join(".")} is not an object`)
		}

		return { target, key }
	}

	private restoreIncomingArgs(args: unknown[]): unknown[] {
		return args.map((arg) => this.restoreIncomingValue(arg))
	}

	private restoreIncomingValue(value: unknown): unknown {
		if (!isCallbackRef(value)) return value
		return (...args: unknown[]) => {
			this.sendCallback(value[CALLBACK_KEY], args)
		}
	}

	private sendCallback(id: string, args: unknown[]): void {
		const transfers: Transferable[] = []
		const processedArgs = args.map((arg) => this.prepareOutgoingValue(arg, transfers))
		this.post({ t: "cb", id, a: processedArgs }, transfers)
	}

	private handleCallback(id: string, args: unknown[]): void {
		const callback = this.callbacks.get(id)
		if (!callback) return
		callback(...this.restoreIncomingArgs(args))
	}

	private sendResponse(id: string, value: unknown, error?: MiniError): void {
		if (error) {
			this.post({ t: "r", id, e: error })
			return
		}

		const transfers: Transferable[] = []
		this.post({ t: "r", id, v: this.prepareOutgoingValue(value, transfers) }, transfers)
	}

	private request(
		op: MiniOperation,
		path: string[],
		args?: unknown[],
		value?: unknown
	): Promise<unknown> {
		if (this.destroyed) return Promise.reject(new Error("RPC channel destroyed"))

		const id = this.nextMessageId()
		const transfers: Transferable[] = []
		const message: MiniMessage = { t: "q", id, op, p: path }

		if (args) {
			message.a = args.map((arg) => this.prepareOutgoingValue(arg, transfers))
		}

		if (op === "set") {
			message.v = this.prepareOutgoingValue(value, transfers)
		}

		return new Promise((resolve, reject) => {
			const pending: PendingRequest = { resolve, reject }
			if (this.timeout && this.timeout !== Infinity) {
				pending.timer = setTimeout(() => {
					this.pending.delete(id)
					reject(timeoutError(path, this.timeout))
				}, this.timeout)
			}

			this.pending.set(id, pending)
			this.post(message, transfers, id)
		})
	}

	private prepareOutgoingValue(value: unknown, transfers: Transferable[]): unknown {
		if (typeof value === "function") {
			return this.createCallbackRef(value as CallbackFunction)
		}

		if (!this.supportsTransfer) return value

		const descriptor = takeTransferDescriptor(value)
		if (!descriptor) return value

		transfers.push(...descriptor.transfers)
		return descriptor.value
	}

	private createCallbackRef(callback: CallbackFunction): CallbackRef {
		let id = this.callbackIds.get(callback)
		if (!id) {
			id = this.nextMessageId()
			this.callbackIds.set(callback, id)
			this.callbacks.set(id, callback)
		}
		return { [CALLBACK_KEY]: id }
	}

	private post(message: MiniMessage, transfers: Transferable[] = [], pendingId?: string): void {
		try {
			const result = this.transport.post(message, transfers)
			void Promise.resolve(result).catch((error: unknown) => {
				this.rejectPendingWrite(pendingId, error)
			})
		} catch (error: unknown) {
			this.rejectPendingWrite(pendingId, error)
		}
	}

	private rejectPendingWrite(pendingId: string | undefined, error: unknown): void {
		if (!pendingId) return

		const pending = this.pending.get(pendingId)
		if (!pending) return

		if (pending.timer) clearTimeout(pending.timer)
		this.pending.delete(pendingId)
		pending.reject(error instanceof Error ? error : new Error(String(error)))
	}

	private createNestedProxy(path: string[]): unknown {
		const target = function rpcProxyTarget() {}

		return new Proxy(target, {
			get: (proxyTarget, prop, receiver) => {
				if (prop === "then") {
					if (path.length === 0) return undefined
					const promise = this.request("get", path)
					return promise.then.bind(promise)
				}

				if (typeof prop !== "string") {
					return Reflect.get(proxyTarget, prop, receiver)
				}

				if (
					prop === "apply" ||
					prop === "call" ||
					prop === "bind" ||
					prop === "length" ||
					prop === "name"
				) {
					return Reflect.get(proxyTarget, prop, receiver)
				}

				return this.createNestedProxy([...path, prop])
			},
			set: (_proxyTarget, prop, value) => {
				if (typeof prop !== "string") return false
				void this.request("set", [...path, prop], undefined, value).catch(() => {})
				return true
			},
			apply: (_proxyTarget, _thisArg, args) => this.request("call", path, Array.from(args)),
			construct: (_proxyTarget, args) => this.request("new", path, Array.from(args))
		})
	}
}
```

- [ ] **Step 4: Add the public source entry**

Create `packages/kkrpc/browser-mini-mod.ts`:

```ts
/**
 * @module @kunkun/kkrpc/browser-mini
 * @description Compact browser-only RPC entrypoint for worker structured-clone transports.
 */

export { RPCChannel, type MiniMessage, type MiniTransport, type RPCChannelOptions } from "./src/browser-mini/channel.ts"
export { WorkerChildIO, WorkerParentIO } from "./src/browser-mini/worker.ts"
export { transfer, type TransferDescriptor } from "./src/transfer.ts"
```

- [ ] **Step 5: Run the mini integration tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-mini.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the benchmark helper tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: PASS.

- [ ] **Step 7: Review the diff checkpoint**

Run from the repository root:

```bash
git diff -- packages/kkrpc/src/browser-mini packages/kkrpc/browser-mini-mod.ts packages/kkrpc/__tests__/browser-mini.test.ts packages/kkrpc/__tests__/scripts/browser-mini-worker.ts
```

Expected: Diff contains only mini source files, the public source entry, and mini tests.

---

### Task 4: Add Package Export And Build Entry

**Files:**
- Modify: `packages/kkrpc/package.json:71-80`
- Modify: `packages/kkrpc/tsdown.config.ts:4-18`

- [ ] **Step 1: Add the package export**

In `packages/kkrpc/package.json`, insert this block after the existing `./browser-lite` export:

```json
		"./browser-mini": {
			"import": {
				"types": "./dist/browser-mini-mod.d.ts",
				"default": "./dist/browser-mini-mod.js"
			},
			"require": {
				"types": "./dist/browser-mini-mod.d.cts",
				"default": "./dist/browser-mini-mod.cjs"
			}
		},
```

The surrounding export order should be:

```json
		"./browser": {
			"import": {
				"types": "./dist/browser-mod.d.ts",
				"default": "./dist/browser-mod.js"
			},
			"require": {
				"types": "./dist/browser-mod.d.cts",
				"default": "./dist/browser-mod.cjs"
			}
		},
		"./browser-lite": {
			"import": {
				"types": "./dist/browser-lite-mod.d.ts",
				"default": "./dist/browser-lite-mod.js"
			},
			"require": {
				"types": "./dist/browser-lite-mod.d.cts",
				"default": "./dist/browser-lite-mod.cjs"
			}
		},
		"./browser-mini": {
			"import": {
				"types": "./dist/browser-mini-mod.d.ts",
				"default": "./dist/browser-mini-mod.js"
			},
			"require": {
				"types": "./dist/browser-mini-mod.d.cts",
				"default": "./dist/browser-mini-mod.cjs"
			}
		},
		"./http": {
```

- [ ] **Step 2: Add the tsdown entry**

In `packages/kkrpc/tsdown.config.ts`, add `"./browser-mini-mod.ts"` after `"./browser-lite-mod.ts"`:

```ts
	entry: [
		"./mod.ts",
		"./browser-mod.ts",
		"./browser-lite-mod.ts",
		"./browser-mini-mod.ts",
		"./http.ts",
		"./deno-mod.ts",
		"./chrome-extension.ts",
		"./socketio.ts",
		"./rabbitmq.ts",
		"./kafka.ts",
		"./redis-streams.ts",
		"./nats.ts",
		"./electron.ts",
		"./electron-ipc.ts",
		"./inspector.ts"
	],
```

- [ ] **Step 3: Run typecheck**

Run from the repository root:

```bash
pnpm --filter kkrpc check-types
```

Expected: PASS.

- [ ] **Step 4: Run focused mini tests again**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-mini.test.ts __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: PASS.

- [ ] **Step 5: Review the diff checkpoint**

Run from the repository root:

```bash
git diff -- packages/kkrpc/package.json packages/kkrpc/tsdown.config.ts
```

Expected: Diff only adds the `./browser-mini` export and tsdown entry.

---

### Task 5: Verify Bundle Output And Guard Against Full-Core Imports

**Files:**
- No source file edits unless verification exposes a bug in earlier tasks.

- [ ] **Step 1: Run the browser bundle comparison**

Run from the repository root:

```bash
pnpm --filter kkrpc compare:browser-bundle-size
```

Expected: PASS and output includes a `kkrpc/browser-mini` row.

- [ ] **Step 2: Inspect the contributor table**

Read the `kkrpc/browser-mini contributors` section printed by the command.

Expected: The mini contributor list does not include these modules:

```text
src/channel-core.ts
src/validation.ts
src/middleware.ts
src/serialization-full.ts
src/serialization-json.ts
src/transfer-handlers.ts
src/adapters/worker.ts
```

- [ ] **Step 3: If forbidden modules appear, fix imports at the source**

Use these checks to locate the accidental import:

```bash
pnpm --filter kkrpc build
```

Expected: PASS.

Then inspect the mini source imports manually. The only runtime imports from outside `src/browser-mini/` should be:

```ts
import { takeTransferDescriptor } from "../transfer.ts"
```

and the public entry should only export from:

```ts
"./src/browser-mini/channel.ts"
"./src/browser-mini/worker.ts"
"./src/transfer.ts"
```

- [ ] **Step 4: Run the browser-lite forbidden import guard**

Run from the repository root:

```bash
pnpm --filter kkrpc check:browser-lite-bundle
```

Expected: PASS. This confirms existing browser-lite behavior remains valid after adding a new entry.

- [ ] **Step 5: Run final focused verification**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-mini.test.ts
bun test __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: PASS.

Run from the repository root:

```bash
pnpm --filter kkrpc check-types
pnpm --filter kkrpc compare:browser-bundle-size
```

Expected: PASS.

- [ ] **Step 6: Review the final diff checkpoint**

Run from the repository root:

```bash
git status --short
git diff --stat
```

Expected: Changes include the previously uncommitted benchmark work, the new browser-mini design and plan docs, and the browser-mini implementation files. No `dist/` or generated docs files should be edited.

---

## Self-Review Notes

- Spec coverage: Tasks cover the new export, tsdown entry, worker-only mini transports, compact channel, call/nested/callback/get/set/construct/transfer/timeout/destroy tests, benchmark case, and final contributor inspection.
- Omitted features: The plan does not add validation, middleware, SuperJSON, string transports, WebSocket, streaming, metadata, broadcast support, transfer handlers, or non-browser adapters.
- Existing entries: The plan only adds a new entry and does not change `browser-mod.ts`, `browser-lite-mod.ts`, `src/channel-core.ts`, or existing full adapters.
- Type consistency: The public entry exports `RPCChannel`, `RPCChannelOptions`, `WorkerParentIO`, `WorkerChildIO`, `transfer`, and transport/message types from the mini files.
- Verification: The focused commands avoid the package-level test script that ignores file arguments and may run unrelated integration tests.
