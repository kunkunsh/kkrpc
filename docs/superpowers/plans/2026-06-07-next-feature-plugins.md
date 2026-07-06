# kkrpc Next Feature Plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in feature modules for `kkrpc/next` so validation, middleware, SuperJSON, and a migration facade are available without increasing the small core bundle for users who do not import them.

**Architecture:** Keep `kkrpc/next` feature-agnostic by adding only a lightweight plugin hook surface to the core. Put heavy features behind separate entrypoints: validation and middleware as plugins, SuperJSON as a codec, and classic compatibility as a facade that translates old-style options into plugins. Feature modules depend on core; core does not import feature modules.

**Tech Stack:** TypeScript, Bun test runner, Standard Schema-compatible validators, SuperJSON, tsdown, package export verification, Bun bundle metafiles.

**Execution Note:** Do not commit unless the user explicitly asks. This workspace already contains unrelated and uncommitted work; use diff/test checkpoints instead of commit steps.

---

## File Structure

- Create: `packages/kkrpc/src/next/plugins.ts`
- Responsibility: Core plugin type definitions, mutable lifecycle contexts, hook runners, and onion composition helpers.

- Create: `packages/kkrpc/next-plugins.ts`
- Responsibility: `kkrpc/next/plugins` public entry.

- Modify: `packages/kkrpc/src/next/channel.ts`
- Responsibility: Accept `plugins?: RPCPlugin[]`, run receiving-side hooks, and let plugins mutate args/result/error.

- Modify: `packages/kkrpc/src/next/index.ts`
- Responsibility: Re-export plugin types from the small core without exporting feature implementations.

- Create: `packages/kkrpc/__tests__/next-plugins.test.ts`
- Responsibility: Core plugin hook order, transformation, error replacement, and no-plugin regression tests.

- Create: `packages/kkrpc/src/next/validation.ts`
- Responsibility: `validationPlugin`, Standard Schema helper re-exports, and method/constructor input/output validation.

- Create: `packages/kkrpc/next-validation.ts`
- Responsibility: `kkrpc/next/validation` public entry.

- Create: `packages/kkrpc/__tests__/next-validation.test.ts`
- Responsibility: Input/output validation, nested lookup, callback filtering, transformed args, and schema-first helpers.

- Create: `packages/kkrpc/src/next/middleware.ts`
- Responsibility: `middlewarePlugin`, interceptor types, and onion middleware runner for vNext handler execution.

- Create: `packages/kkrpc/next-middleware.ts`
- Responsibility: `kkrpc/next/middleware` public entry.

- Create: `packages/kkrpc/__tests__/next-middleware.test.ts`
- Responsibility: Middleware order, blocking, result transformation, args mutation, and shared state behavior.

- Create: `packages/kkrpc/src/next/superjson.ts`
- Responsibility: `superJsonCodec` and `superJsonLineCodec` string codecs.

- Create: `packages/kkrpc/next-superjson.ts`
- Responsibility: `kkrpc/next/superjson` public entry.

- Create: `packages/kkrpc/__tests__/next-superjson.test.ts`
- Responsibility: SuperJSON Date/Map/Set/BigInt round-trip and newline framing.

- Create: `packages/kkrpc/src/next/classic-compat.ts`
- Responsibility: Optional facade translating `validators` and `interceptors` into vNext plugins.

- Create: `packages/kkrpc/next-classic-compat.ts`
- Responsibility: `kkrpc/next/classic-compat` public entry.

- Create: `packages/kkrpc/__tests__/next-classic-compat.test.ts`
- Responsibility: Facade plugin ordering and migration-style channel helpers.

- Modify: `packages/kkrpc/package.json`
- Responsibility: Add `./next/plugins`, `./next/validation`, `./next/middleware`, `./next/superjson`, and `./next/classic-compat` exports.

- Modify: `packages/kkrpc/tsdown.config.ts`
- Responsibility: Add the five new vNext feature entry files.

- Modify: `packages/kkrpc/scripts/compare-browser-bundle-size.ts`
- Responsibility: Add feature entry benchmark cases that prove modular imports.

- Modify: `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts`
- Responsibility: Update benchmark case ordering/source assertions for feature entries.

---

### Task 1: Core Plugin Surface

**Files:**

- Create: `packages/kkrpc/src/next/plugins.ts`
- Create: `packages/kkrpc/next-plugins.ts`
- Modify: `packages/kkrpc/src/next/channel.ts`
- Modify: `packages/kkrpc/src/next/index.ts`
- Create: `packages/kkrpc/__tests__/next-plugins.test.ts`

- [ ] **Step 1: Write failing plugin core tests**

Create `packages/kkrpc/__tests__/next-plugins.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { expose, RPCChannel, wrap } from "../next.ts"
import type { RPCMessage, RPCPlugin, Transport } from "../next.ts"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
	fail(): Promise<void>
}

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true }
	peer?: MemoryTransport
	private listener?: (message: RPCMessage) => void

	send(message: RPCMessage, transfers: Transferable[] = []): void {
		void transfers
		queueMicrotask(() => this.peer?.listener?.(message))
	}

	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listener = listener
		return () => {
			this.listener = undefined
		}
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
	return {
		add: async (a: number, b: number) => a + b,
		fail: async () => {
			throw new Error("original failure")
		}
	}
}

describe("kkrpc/next plugins", () => {
	test("runs receiving-side hooks in onion order", async () => {
		const events: string[] = []
		const { a, b } = createPair()
		const plugins: RPCPlugin[] = [
			{
				name: "outer",
				onRequest: (ctx) => events.push(`outer request ${ctx.method}`),
				wrapHandler: async (_ctx, next) => {
					events.push("outer before")
					const value = await next()
					events.push("outer after")
					return value
				},
				onResponse: (ctx) => events.push(`outer response ${ctx.result}`)
			},
			{
				name: "inner",
				onRequest: (ctx) => events.push(`inner request ${ctx.method}`),
				wrapHandler: async (_ctx, next) => {
					events.push("inner before")
					const value = await next()
					events.push("inner after")
					return value
				},
				onResponse: (ctx) => events.push(`inner response ${ctx.result}`)
			}
		]
		const controller = expose(createApi(), b, { plugins })
		const api = wrap<RemoteAPI>(a)

		try {
			expect(await api.add(1, 2)).toBe(3)
			expect(events).toEqual([
				"outer request add",
				"inner request add",
				"outer before",
				"inner before",
				"inner after",
				"outer after",
				"outer response 3",
				"inner response 3"
			])
		} finally {
			controller.dispose()
		}
	})

	test("plugins can mutate args and results", async () => {
		const { a, b } = createPair()
		const controller = expose(createApi(), b, {
			plugins: [
				{
					onRequest(ctx) {
						ctx.args = [10, 20]
					},
					onResponse(ctx) {
						ctx.result = Number(ctx.result) * 2
					}
				}
			]
		})
		const api = wrap<RemoteAPI>(a)

		try {
			expect(await api.add(1, 2)).toBe(60)
		} finally {
			controller.dispose()
		}
	})

	test("plugins can replace errors before the response is sent", async () => {
		const { a, b } = createPair()
		const controller = expose(createApi(), b, {
			plugins: [
				{
					onError(ctx) {
						ctx.error = new Error(`wrapped ${ctx.method}`)
					}
				}
			]
		})
		const api = wrap<RemoteAPI>(a)

		try {
			await expect(api.fail()).rejects.toThrow("wrapped fail")
		} finally {
			controller.dispose()
		}
	})

	test("no-plugin channels preserve existing core behavior", async () => {
		const { a, b } = createPair()
		const server = new RPCChannel<ReturnType<typeof createApi>, object>(b, { expose: createApi() })
		const client = new RPCChannel<object, RemoteAPI>(a)

		try {
			expect(await client.getAPI().add(2, 5)).toBe(7)
		} finally {
			client.destroy()
			server.destroy()
		}
	})
})
```

- [ ] **Step 2: Run failing plugin core tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-plugins.test.ts
```

Expected: FAIL because `RPCPlugin` is not exported and `plugins` options do not run yet.

- [ ] **Step 3: Implement plugin types and hook runners**

Create `packages/kkrpc/src/next/plugins.ts`:

```ts
import type { RPCOperation } from "./protocol.ts"

export interface RPCPlugin {
	name?: string
	onRequest?(ctx: RPCRequestContext): void | Promise<void>
	wrapHandler?(ctx: RPCHandlerContext, next: () => Promise<unknown>): Promise<unknown>
	onResponse?(ctx: RPCResponseContext): void | Promise<void>
	onError?(ctx: RPCErrorContext): void | Promise<void>
}

export interface RPCRequestContext {
	id: string
	operation: RPCOperation
	path: string[]
	method: string
	args: unknown[]
	value?: unknown
	state: Record<string, unknown>
}

export interface RPCHandlerContext extends RPCRequestContext {
	localAPI: object
}

export interface RPCResponseContext {
	id: string
	operation: RPCOperation
	path: string[]
	method: string
	result: unknown
	state: Record<string, unknown>
}

export interface RPCErrorContext {
	id: string
	operation: RPCOperation
	path: string[]
	method: string
	error: unknown
	state: Record<string, unknown>
}

export async function runRequestHooks(
	plugins: readonly RPCPlugin[],
	ctx: RPCRequestContext
): Promise<void> {
	for (const plugin of plugins) await plugin.onRequest?.(ctx)
}

export function runHandlerHooks(
	plugins: readonly RPCPlugin[],
	ctx: RPCHandlerContext,
	handler: () => Promise<unknown>
): Promise<unknown> {
	let index = -1
	const dispatch = (nextIndex: number): Promise<unknown> => {
		if (nextIndex <= index) throw new Error("RPC plugin next() called multiple times")
		index = nextIndex
		const plugin = plugins[nextIndex]
		if (!plugin) return handler()
		if (!plugin.wrapHandler) return dispatch(nextIndex + 1)
		return plugin.wrapHandler(ctx, () => dispatch(nextIndex + 1))
	}
	return dispatch(0)
}

export async function runResponseHooks(
	plugins: readonly RPCPlugin[],
	ctx: RPCResponseContext
): Promise<void> {
	for (const plugin of plugins) await plugin.onResponse?.(ctx)
}

export async function runErrorHooks(
	plugins: readonly RPCPlugin[],
	ctx: RPCErrorContext
): Promise<void> {
	for (const plugin of plugins) await plugin.onError?.(ctx)
}
```

Create `packages/kkrpc/next-plugins.ts`:

```ts
/**
 * @module @kunkun/kkrpc/next/plugins
 * @description Plugin lifecycle types and helpers for kkrpc/next.
 */

export * from "./src/next/plugins.ts"
```

- [ ] **Step 4: Wire plugins into `RPCChannel`**

Modify `packages/kkrpc/src/next/channel.ts`:

```ts
import {
	runErrorHooks,
	runHandlerHooks,
	runRequestHooks,
	runResponseHooks,
	type RPCPlugin
} from "./plugins.ts"
```

Update options and class state:

```ts
export interface RPCChannelOptions<LocalAPI extends object = object> {
	expose?: LocalAPI
	timeout?: number
	enableTransfer?: boolean
	plugins?: RPCPlugin[]
}

private plugins: readonly RPCPlugin[]

constructor(
	private transport: Transport<RPCMessage>,
	options: RPCChannelOptions<LocalAPI> = {}
) {
	this.expose = options.expose
	this.plugins = options.plugins ?? []
	this.supportsTransfer = options.enableTransfer !== false && transport.capabilities?.transfer === true
	this.timeout = options.timeout ?? 30_000
	this.unsubscribe = transport.subscribe((message) => void this.handleMessage(message))
}
```

Refactor request execution so plugin hooks run around all receiving-side requests:

```ts
private async handleRequest(message: RPCRequest): Promise<void> {
	const transfers: Transferable[] = []
	try {
		const value = await this.executeRequest(message)
		if (this.destroyed) return
		this.post({ t: "r", id: message.id, v: this.encodeValue(value, transfers) }, transfers)
	} catch (error) {
		if (this.destroyed) return
		this.post({ t: "r", id: message.id, e: toRPCError(error) })
	}
}

private async executeRequest(message: RPCRequest): Promise<unknown> {
	if (!this.expose) throw new Error("No API exposed")
	const state: Record<string, unknown> = {}
	const requestCtx = {
		id: message.id,
		operation: message.op,
		path: message.p,
		method: message.p.join("."),
		args: this.decodeArgs(message.a ?? []),
		value: message.v,
		state
	}
	try {
		await runRequestHooks(this.plugins, requestCtx)
		const handlerCtx = { ...requestCtx, localAPI: this.expose as object }
		const result = await runHandlerHooks(this.plugins, handlerCtx, () => this.invokeRequest(handlerCtx))
		const responseCtx = {
			id: message.id,
			operation: message.op,
			path: message.p,
			method: message.p.join("."),
			result,
			state
		}
		await runResponseHooks(this.plugins, responseCtx)
		return responseCtx.result
	} catch (error) {
		const errorCtx = {
			id: message.id,
			operation: message.op,
			path: message.p,
			method: message.p.join("."),
			error,
			state
		}
		await runErrorHooks(this.plugins, errorCtx)
		throw errorCtx.error
	}
}

private async invokeRequest(ctx: {
	operation: RPCOperation
	path: string[]
	args: unknown[]
	value?: unknown
}): Promise<unknown> {
	if (!this.expose) throw new Error("No API exposed")
	if (ctx.operation === "get") return getPath(this.expose, ctx.path)
	if (ctx.operation === "set") {
		const { parent, key } = getParent(this.expose, ctx.path)
		Reflect.set(parent, key, ctx.value)
		return true
	}
	const target = getPath(this.expose, ctx.path)
	if (ctx.operation === "new") {
		return Reflect.construct(target as new (...args: unknown[]) => unknown, ctx.args)
	}
	if (typeof target !== "function") throw new Error(`${ctx.path.join(".")} is not a function`)
	const receiver = ctx.path.length > 0 ? getPath(this.expose, ctx.path.slice(0, -1)) : undefined
	return await Reflect.apply(target, receiver, ctx.args)
}
```

- [ ] **Step 5: Export plugin types from core**

Modify `packages/kkrpc/src/next/index.ts`:

```ts
export type {
	RPCErrorContext,
	RPCHandlerContext,
	RPCPlugin,
	RPCRequestContext,
	RPCResponseContext
} from "./plugins.ts"
```

- [ ] **Step 6: Run plugin core tests and existing focused tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-plugins.test.ts
bun test __tests__/next-core.test.ts __tests__/next-transport-codecs.test.ts __tests__/next-worker.test.ts __tests__/next-stdio.test.ts
```

Expected: PASS.

---

### Task 2: Validation Plugin

**Files:**

- Create: `packages/kkrpc/src/next/validation.ts`
- Create: `packages/kkrpc/next-validation.ts`
- Create: `packages/kkrpc/__tests__/next-validation.test.ts`

- [ ] **Step 1: Write failing validation tests**

Create `packages/kkrpc/__tests__/next-validation.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
	defineAPI,
	defineMethod,
	extractValidators,
	isRPCValidationError,
	validationPlugin
} from "../next-validation.ts"
import { expose, wrap } from "../next.ts"
import type { RPCMessage, Transport } from "../next.ts"

interface API {
	add(a: number, b: number): Promise<number>
	withCallback(a: number, callback: (value: number) => void): Promise<number>
	math: {
		double(value: number): Promise<number>
	}
}

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true }
	peer?: MemoryTransport
	private listener?: (message: RPCMessage) => void
	send(message: RPCMessage): void {
		queueMicrotask(() => this.peer?.listener?.(message))
	}
	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listener = listener
		return () => {
			this.listener = undefined
		}
	}
}

function createPair() {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return { a, b }
}

function createApi(): API {
	return {
		add: async (a, b) => a + b,
		withCallback: async (a, callback) => {
			callback(a + 1)
			return a
		},
		math: {
			double: async (value) => value * 2
		}
	}
}

describe("kkrpc/next validation plugin", () => {
	test("rejects invalid input", async () => {
		const { a, b } = createPair()
		const controller = expose(createApi(), b, {
			plugins: [
				validationPlugin({
					add: { input: z.tuple([z.number(), z.number()]), output: z.number() }
				})
			]
		})
		const api = wrap<API>(a)

		try {
			await expect(api.add("x" as unknown as number, 2)).rejects.toThrow("input validation failed")
		} finally {
			controller.dispose()
		}
	})

	test("rejects invalid output", async () => {
		const { a, b } = createPair()
		const broken = { add: async () => "bad" }
		const controller = expose(broken, b, {
			plugins: [validationPlugin({ add: { output: z.number() } })]
		})
		const api = wrap<{ add(): Promise<number> }>(a)

		try {
			await expect(api.add()).rejects.toThrow("output validation failed")
		} finally {
			controller.dispose()
		}
	})

	test("validates nested methods and filters callback args", async () => {
		const { a, b } = createPair()
		const controller = expose(createApi(), b, {
			plugins: [
				validationPlugin({
					withCallback: { input: z.tuple([z.number()]), output: z.number() },
					math: { double: { input: z.tuple([z.number()]), output: z.number() } }
				})
			]
		})
		const api = wrap<API>(a)
		let callbackValue = 0

		try {
			expect(await api.math.double(3)).toBe(6)
			expect(
				await api.withCallback(4, (value) => {
					callbackValue = value
				})
			).toBe(4)
			expect(callbackValue).toBe(5)
		} finally {
			controller.dispose()
		}
	})

	test("schema-first helpers produce validators", async () => {
		const apiImpl = defineAPI({
			echo: defineMethod({ input: z.tuple([z.string()]), output: z.string() }, async (value) =>
				value.toUpperCase()
			)
		})
		const { a, b } = createPair()
		const controller = expose(apiImpl, b, {
			plugins: [validationPlugin(extractValidators(apiImpl))]
		})
		const api = wrap<{ echo(value: string): Promise<string> }>(a)

		try {
			expect(await api.echo("ok")).toBe("OK")
			await expect(api.echo(1 as unknown as string)).rejects.toThrow("input validation failed")
		} finally {
			controller.dispose()
		}
	})

	test("validation errors are detectable by name", async () => {
		const { a, b } = createPair()
		const controller = expose(createApi(), b, {
			plugins: [validationPlugin({ add: { input: z.tuple([z.number(), z.number()]) } })]
		})
		const api = wrap<API>(a)

		try {
			try {
				await api.add("x" as unknown as number, 1)
				throw new Error("expected validation failure")
			} catch (error) {
				expect(error).toBeInstanceOf(Error)
				expect((error as Error).name).toBe("RPCValidationError")
				expect(isRPCValidationError(error)).toBe(true)
			}
		} finally {
			controller.dispose()
		}
	})
})
```

- [ ] **Step 2: Run failing validation tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-validation.test.ts
```

Expected: FAIL because `../next-validation.ts` does not exist.

- [ ] **Step 3: Implement validation plugin**

Create `packages/kkrpc/src/next/validation.ts`:

```ts
import {
	defineAPI,
	defineMethod,
	extractValidators,
	isRPCValidationError,
	lookupValidator,
	RPCValidationError,
	runValidation,
	type InferAPI,
	type MethodValidators,
	type RPCValidators,
	type StandardSchemaV1
} from "../validation.ts"
import type { RPCPlugin, RPCRequestContext, RPCResponseContext } from "./plugins.ts"

export {
	RPCValidationError,
	defineAPI,
	defineMethod,
	extractValidators,
	isRPCValidationError,
	type InferAPI,
	type MethodValidators,
	type RPCValidators,
	type StandardSchemaV1
}

function filterCallbacks(args: unknown[]): unknown[] {
	return args.filter((arg) => typeof arg !== "function")
}

function mergeValidatedArgs(original: unknown[], validated: unknown): unknown[] {
	if (!Array.isArray(validated)) return original
	const result = [...original]
	let nextValidated = 0
	for (let index = 0; index < result.length; index++) {
		if (typeof result[index] === "function") continue
		if (nextValidated < validated.length) result[index] = validated[nextValidated++]
	}
	return result
}

async function validateInput(
	validators: Record<string, unknown> | undefined,
	ctx: RPCRequestContext
): Promise<void> {
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
	if (ctx.operation !== "call" && ctx.operation !== "new") return
	const methodValidators = lookupValidator(validators, ctx.method)
	const result = await runValidation(methodValidators?.output, ctx.result)
	if (!result.success) throw new RPCValidationError("output", ctx.method, result.issues)
	ctx.result = result.value
}

export function validationPlugin<API extends object>(
	validators: RPCValidators<API> | Record<string, unknown> | undefined
): RPCPlugin {
	return {
		name: "validation",
		onRequest: (ctx) => validateInput(validators as Record<string, unknown> | undefined, ctx),
		onResponse: (ctx) => validateOutput(validators as Record<string, unknown> | undefined, ctx)
	}
}
```

Create `packages/kkrpc/next-validation.ts`:

```ts
/**
 * @module @kunkun/kkrpc/next/validation
 * @description Optional Standard Schema validation plugin for kkrpc/next.
 */

export * from "./src/next/validation.ts"
```

- [ ] **Step 4: Run validation tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-validation.test.ts
bun test __tests__/next-plugins.test.ts __tests__/next-core.test.ts
```

Expected: PASS.

---

### Task 3: Middleware Plugin

**Files:**

- Create: `packages/kkrpc/src/next/middleware.ts`
- Create: `packages/kkrpc/next-middleware.ts`
- Create: `packages/kkrpc/__tests__/next-middleware.test.ts`

- [ ] **Step 1: Write failing middleware tests**

Create `packages/kkrpc/__tests__/next-middleware.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { middlewarePlugin, type RPCInterceptor } from "../next-middleware.ts"
import { expose, wrap } from "../next.ts"
import type { RPCMessage, Transport } from "../next.ts"

interface API {
	add(a: number, b: number): Promise<number>
	secret(): Promise<string>
}

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true }
	peer?: MemoryTransport
	private listener?: (message: RPCMessage) => void
	send(message: RPCMessage): void {
		queueMicrotask(() => this.peer?.listener?.(message))
	}
	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listener = listener
		return () => {
			this.listener = undefined
		}
	}
}

function createPair() {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return { a, b }
}

const apiImpl: API = {
	add: async (a, b) => a + b,
	secret: async () => "secret"
}

describe("kkrpc/next middleware plugin", () => {
	test("runs interceptors in onion order", async () => {
		const events: string[] = []
		const interceptors: RPCInterceptor[] = [
			async (ctx, next) => {
				events.push(`outer before ${ctx.method}`)
				const value = await next()
				events.push("outer after")
				return value
			},
			async (_ctx, next) => {
				events.push("inner before")
				const value = await next()
				events.push("inner after")
				return value
			}
		]
		const { a, b } = createPair()
		const controller = expose(apiImpl, b, { plugins: [middlewarePlugin(interceptors)] })
		const api = wrap<API>(a)

		try {
			expect(await api.add(1, 2)).toBe(3)
			expect(events).toEqual(["outer before add", "inner before", "inner after", "outer after"])
		} finally {
			controller.dispose()
		}
	})

	test("interceptors can mutate args and transform results", async () => {
		const { a, b } = createPair()
		const controller = expose(apiImpl, b, {
			plugins: [
				middlewarePlugin([
					async (ctx, next) => {
						ctx.args = [5, 6]
						return Number(await next()) * 10
					}
				])
			]
		})
		const api = wrap<API>(a)

		try {
			expect(await api.add(1, 2)).toBe(110)
		} finally {
			controller.dispose()
		}
	})

	test("interceptors can block a call", async () => {
		const { a, b } = createPair()
		const controller = expose(apiImpl, b, {
			plugins: [
				middlewarePlugin([
					async (ctx, next) => {
						if (ctx.method === "secret") throw new Error("blocked")
						return await next()
					}
				])
			]
		})
		const api = wrap<API>(a)

		try {
			await expect(api.secret()).rejects.toThrow("blocked")
		} finally {
			controller.dispose()
		}
	})

	test("interceptors share state", async () => {
		const { a, b } = createPair()
		const controller = expose(apiImpl, b, {
			plugins: [
				middlewarePlugin([
					async (ctx, next) => {
						ctx.state.multiplier = 4
						return await next()
					},
					async (ctx, next) => Number(await next()) * Number(ctx.state.multiplier)
				])
			]
		})
		const api = wrap<API>(a)

		try {
			expect(await api.add(2, 3)).toBe(20)
		} finally {
			controller.dispose()
		}
	})
})
```

- [ ] **Step 2: Run failing middleware tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-middleware.test.ts
```

Expected: FAIL because `../next-middleware.ts` does not exist.

- [ ] **Step 3: Implement middleware plugin**

Create `packages/kkrpc/src/next/middleware.ts`:

```ts
import type { RPCPlugin } from "./plugins.ts"

export interface RPCCallContext {
	id: string
	method: string
	args: unknown[]
	state: Record<string, unknown>
}

export type RPCInterceptor = (ctx: RPCCallContext, next: () => Promise<unknown>) => Promise<unknown>

export function runInterceptors(
	interceptors: readonly RPCInterceptor[],
	ctx: RPCCallContext,
	handler: () => Promise<unknown>
): Promise<unknown> {
	let index = -1
	const dispatch = (nextIndex: number): Promise<unknown> => {
		if (nextIndex <= index) throw new Error("RPC interceptor next() called multiple times")
		index = nextIndex
		const interceptor = interceptors[nextIndex]
		if (!interceptor) return handler()
		return interceptor(ctx, () => dispatch(nextIndex + 1))
	}
	return dispatch(0)
}

export function middlewarePlugin(interceptors: readonly RPCInterceptor[]): RPCPlugin {
	return {
		name: "middleware",
		wrapHandler: async (ctx, next) => {
			const callCtx: RPCCallContext = {
				id: ctx.id,
				method: ctx.method,
				args: ctx.args,
				state: ctx.state
			}
			const result = await runInterceptors(interceptors, callCtx, async () => {
				ctx.args = callCtx.args
				return await next()
			})
			ctx.args = callCtx.args
			return result
		}
	}
}
```

Create `packages/kkrpc/next-middleware.ts`:

```ts
/**
 * @module @kunkun/kkrpc/next/middleware
 * @description Optional interceptor middleware plugin for kkrpc/next.
 */

export * from "./src/next/middleware.ts"
```

- [ ] **Step 4: Run middleware tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-middleware.test.ts
bun test __tests__/next-plugins.test.ts __tests__/next-validation.test.ts
```

Expected: PASS.

---

### Task 4: SuperJSON Codecs

**Files:**

- Create: `packages/kkrpc/src/next/superjson.ts`
- Create: `packages/kkrpc/next-superjson.ts`
- Create: `packages/kkrpc/__tests__/next-superjson.test.ts`

- [ ] **Step 1: Write failing SuperJSON tests**

Create `packages/kkrpc/__tests__/next-superjson.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { superJsonCodec, superJsonLineCodec } from "../next-superjson.ts"
import { createTransport, type Platform } from "../next-transport.ts"

class StringPlatform implements Platform<string> {
	capabilities = { objectMode: false, transfer: false }
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

describe("kkrpc/next SuperJSON codecs", () => {
	test("superJsonCodec round-trips non-JSON values", () => {
		const codec = superJsonCodec<unknown>()
		const input = {
			date: new Date("2026-06-07T00:00:00.000Z"),
			map: new Map([["a", 1]]),
			set: new Set(["x", "y"]),
			bigint: 123n
		}
		const output = codec.decode(codec.encode(input)) as typeof input

		expect(output.date).toBeInstanceOf(Date)
		expect(output.date.toISOString()).toBe("2026-06-07T00:00:00.000Z")
		expect(output.map).toBeInstanceOf(Map)
		expect(output.map.get("a")).toBe(1)
		expect(output.set).toBeInstanceOf(Set)
		expect(output.set.has("x")).toBe(true)
		expect(output.bigint).toBe(123n)
		expect(codec.capabilities?.transfer).toBe(false)
	})

	test("superJsonLineCodec adds newline framing", () => {
		const codec = superJsonLineCodec<{ value: Date }>()
		const wire = codec.encode({ value: new Date("2026-06-07T00:00:00.000Z") })
		const decoded = codec.decode(wire)

		expect(wire.endsWith("\n")).toBe(true)
		expect(decoded.value).toBeInstanceOf(Date)
	})

	test("composes with createTransport", () => {
		const platform = new StringPlatform()
		const transport = createTransport({ platform, codec: superJsonCodec<{ value: bigint }>() })
		const received: Array<{ value: bigint }> = []

		const unsubscribe = transport.subscribe((message) => received.push(message))
		transport.send({ value: 5n }, [new ArrayBuffer(1)])
		expect(platform.wires).toHaveLength(1)
		expect(transport.capabilities?.transfer).toBe(false)
		platform.listener?.(platform.wires[0])
		expect(received).toEqual([{ value: 5n }])
		unsubscribe()
		expect(platform.listener).toBeUndefined()
	})
})
```

- [ ] **Step 2: Run failing SuperJSON tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-superjson.test.ts
```

Expected: FAIL because `../next-superjson.ts` does not exist.

- [ ] **Step 3: Implement SuperJSON codecs**

Create `packages/kkrpc/src/next/superjson.ts`:

```ts
import superjson from "superjson"
import type { Codec } from "./transport.ts"

export function superJsonCodec<TMessage>(): Codec<TMessage, string> {
	return {
		capabilities: { transfer: false },
		encode: (message) => superjson.stringify(message),
		decode: (wire) => superjson.parse<TMessage>(wire)
	}
}

export function superJsonLineCodec<TMessage>(): Codec<TMessage, string> {
	const codec = superJsonCodec<TMessage>()
	return {
		capabilities: { transfer: false },
		encode: (message) => `${codec.encode(message)}\n`,
		decode: (wire) => codec.decode(wire.trimEnd())
	}
}
```

Create `packages/kkrpc/next-superjson.ts`:

```ts
/**
 * @module @kunkun/kkrpc/next/superjson
 * @description Optional SuperJSON codecs for kkrpc/next transports.
 */

export * from "./src/next/superjson.ts"
```

- [ ] **Step 4: Run SuperJSON tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-superjson.test.ts
bun test __tests__/next-transport-codecs.test.ts
```

Expected: PASS.

---

### Task 5: Classic Compatibility Facade

**Files:**

- Create: `packages/kkrpc/src/next/classic-compat.ts`
- Create: `packages/kkrpc/next-classic-compat.ts`
- Create: `packages/kkrpc/__tests__/next-classic-compat.test.ts`

- [ ] **Step 1: Write failing compat tests**

Create `packages/kkrpc/__tests__/next-classic-compat.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
	classicPlugins,
	createCompatChannel,
	exposeCompat,
	wrapCompat
} from "../next-classic-compat.ts"
import type { RPCMessage, Transport } from "../next.ts"

interface API {
	add(a: number, b: number): Promise<number>
}

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true }
	peer?: MemoryTransport
	private listener?: (message: RPCMessage) => void
	send(message: RPCMessage): void {
		queueMicrotask(() => this.peer?.listener?.(message))
	}
	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listener = listener
		return () => {
			this.listener = undefined
		}
	}
}

function createPair() {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return { a, b }
}

describe("kkrpc/next classic compatibility facade", () => {
	test("classicPlugins translates validators and interceptors", async () => {
		const { a, b } = createPair()
		const plugins = classicPlugins<API>({
			validators: { add: { input: z.tuple([z.number(), z.number()]), output: z.number() } },
			interceptors: [async (ctx, next) => Number(await next()) * 2]
		})
		const server = createCompatChannel<{ add(a: number, b: number): Promise<number> }, object>(b, {
			expose: { add: async (a, b) => a + b },
			plugins
		})
		const client = createCompatChannel<object, API>(a)

		try {
			expect(await client.getAPI().add(1, 2)).toBe(6)
			await expect(client.getAPI().add("x" as unknown as number, 2)).rejects.toThrow(
				"input validation failed"
			)
		} finally {
			client.destroy()
			server.destroy()
		}
	})

	test("wrapCompat and exposeCompat accept migration-style options", async () => {
		const { a, b } = createPair()
		const controller = exposeCompat({ add: async (a: number, b: number) => a + b }, b, {
			validators: { add: { input: z.tuple([z.number(), z.number()]), output: z.number() } },
			interceptors: [async (_ctx, next) => Number(await next()) + 1]
		})
		const api = wrapCompat<API>(a)

		try {
			expect(await api.add(2, 3)).toBe(6)
		} finally {
			controller.dispose()
		}
	})
})
```

- [ ] **Step 2: Run failing compat tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-classic-compat.test.ts
```

Expected: FAIL because `../next-classic-compat.ts` does not exist.

- [ ] **Step 3: Implement compat facade**

Create `packages/kkrpc/src/next/classic-compat.ts`:

```ts
import {
	expose,
	RPCChannel,
	wrap,
	type ExposedController,
	type RPCChannelOptions
} from "./index.ts"
import { middlewarePlugin, type RPCInterceptor } from "./middleware.ts"
import type { RPCPlugin } from "./plugins.ts"
import type { RPCMessage } from "./protocol.ts"
import type { Transport } from "./transport.ts"
import { validationPlugin, type RPCValidators } from "./validation.ts"

export interface ClassicCompatOptions<LocalAPI extends object = object>
	extends RPCChannelOptions<LocalAPI> {
	validators?: RPCValidators<LocalAPI> | Record<string, unknown>
	interceptors?: RPCInterceptor[]
}

export function classicPlugins<LocalAPI extends object>(
	options: Pick<ClassicCompatOptions<LocalAPI>, "validators" | "interceptors" | "plugins">
): RPCPlugin[] {
	const plugins: RPCPlugin[] = []
	if (options.validators) plugins.push(validationPlugin(options.validators))
	if (options.interceptors?.length) plugins.push(middlewarePlugin(options.interceptors))
	plugins.push(...(options.plugins ?? []))
	return plugins
}

function toChannelOptions<LocalAPI extends object>(
	options: ClassicCompatOptions<LocalAPI> = {}
): RPCChannelOptions<LocalAPI> {
	return {
		expose: options.expose,
		timeout: options.timeout,
		enableTransfer: options.enableTransfer,
		plugins: classicPlugins(options)
	}
}

export function createCompatChannel<
	LocalAPI extends object = object,
	RemoteAPI extends object = object
>(
	transport: Transport<RPCMessage>,
	options: ClassicCompatOptions<LocalAPI> = {}
): RPCChannel<LocalAPI, RemoteAPI> {
	return new RPCChannel<LocalAPI, RemoteAPI>(transport, toChannelOptions(options))
}

export function wrapCompat<RemoteAPI extends object = object>(
	transport: Transport<RPCMessage>,
	options: Omit<ClassicCompatOptions<object>, "expose"> = {}
): RemoteAPI {
	return wrap<RemoteAPI>(transport, { ...options, plugins: classicPlugins(options) })
}

export function exposeCompat<LocalAPI extends object, RemoteAPI extends object = object>(
	api: LocalAPI,
	transport: Transport<RPCMessage>,
	options: Omit<ClassicCompatOptions<LocalAPI>, "expose"> = {}
): ExposedController<LocalAPI, RemoteAPI> {
	return expose<LocalAPI, RemoteAPI>(api, transport, {
		...options,
		plugins: classicPlugins(options)
	})
}
```

Create `packages/kkrpc/next-classic-compat.ts`:

```ts
/**
 * @module @kunkun/kkrpc/next/classic-compat
 * @description Optional migration facade for kkrpc/next validators and interceptors.
 */

export * from "./src/next/classic-compat.ts"
```

- [ ] **Step 4: Run compat tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-classic-compat.test.ts
bun test __tests__/next-validation.test.ts __tests__/next-middleware.test.ts
```

Expected: PASS.

---

### Task 6: Package Exports, Build Entries, And Benchmarks

**Files:**

- Modify: `packages/kkrpc/package.json`
- Modify: `packages/kkrpc/tsdown.config.ts`
- Modify: `packages/kkrpc/scripts/compare-browser-bundle-size.ts`
- Modify: `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts`

- [ ] **Step 1: Write failing benchmark helper expectations**

Update the expected case list in `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts` to include feature entries after `kkrpc/next/worker`:

```ts
expect(cases.map((entry) => entry.name)).toEqual([
	"kkrpc/browser",
	"kkrpc/browser-lite",
	"kkrpc/next",
	"kkrpc/next/worker",
	"kkrpc/next/validation",
	"kkrpc/next/middleware",
	"kkrpc/next/superjson",
	"kkrpc/next/classic-compat",
	"kkrpc/browser-mini",
	"kkrpc-lite direct",
	"comctx"
])
```

Add source assertions for the new rows:

```ts
expect(cases[4]?.source).toContain('from "kkrpc/next/validation"')
expect(cases[5]?.source).toContain('from "kkrpc/next/middleware"')
expect(cases[6]?.source).toContain('from "kkrpc/next/superjson"')
expect(cases[7]?.source).toContain('from "kkrpc/next/classic-compat"')
```

- [ ] **Step 2: Run failing benchmark helper test**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: FAIL because feature benchmark cases are not present.

- [ ] **Step 3: Add package exports and build entries**

In `packages/kkrpc/package.json`, add exports after `./next` or after the existing vNext group:

```json
		"./next/plugins": {
			"import": { "types": "./dist/next-plugins.d.ts", "default": "./dist/next-plugins.js" },
			"require": { "types": "./dist/next-plugins.d.cts", "default": "./dist/next-plugins.cjs" }
		},
		"./next/validation": {
			"import": { "types": "./dist/next-validation.d.ts", "default": "./dist/next-validation.js" },
			"require": { "types": "./dist/next-validation.d.cts", "default": "./dist/next-validation.cjs" }
		},
		"./next/middleware": {
			"import": { "types": "./dist/next-middleware.d.ts", "default": "./dist/next-middleware.js" },
			"require": { "types": "./dist/next-middleware.d.cts", "default": "./dist/next-middleware.cjs" }
		},
		"./next/superjson": {
			"import": { "types": "./dist/next-superjson.d.ts", "default": "./dist/next-superjson.js" },
			"require": { "types": "./dist/next-superjson.d.cts", "default": "./dist/next-superjson.cjs" }
		},
		"./next/classic-compat": {
			"import": { "types": "./dist/next-classic-compat.d.ts", "default": "./dist/next-classic-compat.js" },
			"require": { "types": "./dist/next-classic-compat.d.cts", "default": "./dist/next-classic-compat.cjs" }
		},
```

In `packages/kkrpc/tsdown.config.ts`, add entries after existing vNext entries:

```ts
		"./next-plugins.ts",
		"./next-validation.ts",
		"./next-middleware.ts",
		"./next-superjson.ts",
		"./next-classic-compat.ts",
```

- [ ] **Step 4: Add feature benchmark cases**

In `packages/kkrpc/scripts/compare-browser-bundle-size.ts`, add cases after `kkrpc/next/worker`:

```ts
		{
			name: "kkrpc/next/validation",
			fileName: "kkrpc-next-validation.ts",
			source: createKkrpcNextFeatureSample("kkrpc/next/validation", "validationPlugin")
		},
		{
			name: "kkrpc/next/middleware",
			fileName: "kkrpc-next-middleware.ts",
			source: createKkrpcNextFeatureSample("kkrpc/next/middleware", "middlewarePlugin")
		},
		{
			name: "kkrpc/next/superjson",
			fileName: "kkrpc-next-superjson.ts",
			source: createKkrpcNextFeatureSample("kkrpc/next/superjson", "superJsonCodec")
		},
		{
			name: "kkrpc/next/classic-compat",
			fileName: "kkrpc-next-classic-compat.ts",
			source: createKkrpcNextFeatureSample("kkrpc/next/classic-compat", "classicPlugins")
		},
```

Add helper:

```ts
function createKkrpcNextFeatureSample(importPath: string, exportName: string): string {
	return `import { ${exportName} } from "${importPath}"

export function getFeature() {
	return ${exportName}
}

Object.assign(globalThis, { getFeature })
`
}
```

- [ ] **Step 5: Run benchmark helper test and focused feature tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-bundle-benchmark-script.test.ts
bun test __tests__/next-plugins.test.ts __tests__/next-validation.test.ts __tests__/next-middleware.test.ts __tests__/next-superjson.test.ts __tests__/next-classic-compat.test.ts
```

Expected: PASS.

---

### Task 7: Final Verification And Bundle Modularity

**Files:**

- No source edits unless verification exposes a bug.

- [ ] **Step 1: Run focused next feature tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/next-core.test.ts __tests__/next-plugins.test.ts __tests__/next-validation.test.ts __tests__/next-middleware.test.ts __tests__/next-superjson.test.ts __tests__/next-classic-compat.test.ts __tests__/next-transport-codecs.test.ts __tests__/next-worker.test.ts __tests__/next-stdio.test.ts __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run from repository root:

```bash
pnpm --filter kkrpc check-types
```

Expected: PASS.

- [ ] **Step 3: Run package build and bundle guard**

Run from repository root:

```bash
pnpm --filter kkrpc check:browser-lite-bundle
```

Expected: PASS. Existing Typedoc warnings are acceptable only if the command exits successfully.

- [ ] **Step 4: Run bundle comparison**

Run from repository root:

```bash
pnpm --filter kkrpc compare:browser-bundle-size
```

Expected: PASS and output includes rows for:

```text
kkrpc/next
kkrpc/next/validation
kkrpc/next/middleware
kkrpc/next/superjson
kkrpc/next/classic-compat
```

Inspect contributor tables. `kkrpc/next` must not include:

```text
superjson
src/validation.ts
src/middleware.ts
src/channel-core.ts
src/serialization-full.ts
src/serialization-json.ts
```

`kkrpc/next/superjson` is allowed to include `superjson`. `kkrpc/next/validation` is allowed to include
validation helper code. `kkrpc/next/classic-compat` is allowed to include validation and middleware helper
code because users opt into the facade explicitly.

- [ ] **Step 5: Final status checkpoint**

Run from repository root:

```bash
git status --short
git diff --stat
```

Expected: No `dist/` edits. Existing unrelated workspace changes may still be present; do not revert them.

---

## Self-Review Notes

- Spec coverage: Tasks cover plugin hook surface, `plugins` options, validation plugin, middleware plugin,
  SuperJSON codecs, classic compatibility facade, package exports, build entries, benchmark rows, and final
  modularity verification.
- Deferred scope: metadata/tracing, streaming, rich transfer handlers, broadcast, property validators, and
  structured SuperJSON transfer are explicitly deferred.
- Type consistency: `RPCPlugin`, `RPCRequestContext`, `RPCHandlerContext`, `RPCResponseContext`,
  `RPCErrorContext`, `validationPlugin`, `middlewarePlugin`, `superJsonCodec`, `superJsonLineCodec`,
  `classicPlugins`, `createCompatChannel`, `wrapCompat`, and `exposeCompat` names are consistent across
  tasks.
- Placeholder scan: No task uses placeholder/fill-in language. Each code step includes concrete file content or
  exact code snippets to apply.
- Commit policy: Plan intentionally omits commit steps because commits were not explicitly requested.
