# Browser Lite Serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `kkrpc/browser-lite` entrypoint that keeps the existing `new RPCChannel(...)` facade while avoiding any static SuperJSON dependency.

**Architecture:** Split the current serialization/channel coupling into shared protocol types, a JSON-only serializer, a full SuperJSON serializer, and a shared `RPCChannelCore` that receives its serializer runtime from thin public wrappers. Keep `kkrpc` and `kkrpc/browser` fully compatible; add `kkrpc/browser-lite` as an opt-in JSON-only browser build.

**Tech Stack:** TypeScript, Bun tests, tsdown build, pnpm workspace, kkrpc `IoInterface` adapters, existing package export verification.

---

## Commit Policy

This plan includes checkpoint steps for small commits because the implementation is broad. Only run the commit commands if the user explicitly requests commits. Otherwise, stop at verification and leave changes unstaged or staged as appropriate for review.

## File Structure

Create or modify these files:

- Create: `packages/kkrpc/src/serialization-types.ts`
- Create: `packages/kkrpc/src/serialization-json.ts`
- Create: `packages/kkrpc/src/serialization-full.ts`
- Modify: `packages/kkrpc/src/serialization.ts`
- Create: `packages/kkrpc/src/channel-core.ts`
- Modify: `packages/kkrpc/src/channel.ts`
- Create: `packages/kkrpc/src/channel-lite.ts`
- Create: `packages/kkrpc/browser-lite-mod.ts`
- Modify: `packages/kkrpc/tsdown.config.ts`
- Modify: `packages/kkrpc/package.json`
- Modify: `packages/kkrpc/deno.json`
- Modify: `packages/kkrpc/__tests__/serialization.test.ts`
- Create: `packages/kkrpc/__tests__/browser-lite.test.ts`
- Create: `packages/kkrpc/scripts/check-browser-lite-bundle.ts`
- Modify: `packages/kkrpc/package.json` scripts
- Modify: `README.md`

Boundary decisions:

- `serialization-types.ts` owns protocol types only. It imports nothing from SuperJSON or transfer modules.
- `serialization-json.ts` owns JSON/string encoding, structured envelope encoding, transfer slot processing, and error serialization. It imports no SuperJSON.
- `serialization-full.ts` owns SuperJSON support and full default behavior.
- `serialization.ts` remains a compatibility barrel for existing imports.
- `channel-core.ts` owns the RPC state machine and imports protocol types from `serialization-types.ts`, not `serialization.ts`.
- `channel.ts` and `channel-lite.ts` are thin public wrappers that export the same `RPCChannel` class facade.

### Task 1: Extract Protocol Types And JSON Serializer

**Files:**

- Create: `packages/kkrpc/src/serialization-types.ts`
- Create: `packages/kkrpc/src/serialization-json.ts`
- Modify: `packages/kkrpc/__tests__/serialization.test.ts`

- [ ] **Step 1: Add failing JSON serializer tests**

Append these tests to `packages/kkrpc/__tests__/serialization.test.ts` before creating the new modules:

```ts
import {
	decodeJsonMessage,
	encodeJsonMessage,
	jsonSerializationRuntime,
	type Message
} from "../src/serialization-json.ts"
```

Add this `describe` block after the existing `describe("Serializer", ...)` block:

```ts
describe("JSON-only serialization", () => {
	test("round-trips JSON messages without SuperJSON", async () => {
		const message: Message = {
			id: "json-1",
			method: "echo",
			args: ["hello", new Uint8Array([1, 2, 3])],
			type: "request"
		}

		const serialized = encodeJsonMessage(message)
		const deserialized = await decodeJsonMessage(serialized)

		expect(deserialized).toEqual({ ...message, version: "json" } as Message)
	})

	test("rejects SuperJSON-looking strings with a clear lite error", async () => {
		const superjsonLike = '{"json":{"id":"1","method":"echo","args":[],"type":"request"}}\n'

		await expect(decodeJsonMessage(superjsonLike)).rejects.toThrow(
			"Received a SuperJSON-encoded kkrpc message"
		)
	})

	test("encodes structured envelopes without SuperJSON", async () => {
		const message: Message = {
			id: "structured-1",
			method: "echo",
			args: ["hello"],
			type: "request"
		}

		const encoded = jsonSerializationRuntime.encodeMessage(message, {}, true)

		expect(encoded.mode).toBe("structured")
		if (encoded.mode !== "structured") {
			expect.unreachable("expected structured encoding")
		}
		expect(encoded.data.payload).toEqual(message)
		expect(await jsonSerializationRuntime.decodeMessage(encoded.data)).toEqual(message)
	})
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/serialization.test.ts
```

Expected: FAIL because `../src/serialization-json.ts` does not exist.

- [ ] **Step 3: Create `serialization-types.ts`**

Create `packages/kkrpc/src/serialization-types.ts` with this content:

```ts
/**
 * Shared wire protocol types for kkrpc serializers and channels.
 * This file has no runtime dependencies so lite entrypoints can reuse the
 * protocol shape without importing SuperJSON or full serialization helpers.
 */

export interface Message<T = unknown> {
	id: string
	method: string
	args: T
	type:
		| "request"
		| "response"
		| "callback"
		| "get"
		| "set"
		| "construct"
		| "stream-chunk"
		| "stream-end"
		| "stream-error"
		| "stream-cancel"
	callbackIds?: string[]
	version?: "json" | "superjson"
	meta?: RPCMessageMetadata
	path?: string[]
	value?: unknown
	transferSlots?: TransferSlot[]
}

/**
 * Optional out-of-band metadata carried with an RPC message.
 */
export interface RPCMessageMetadata {
	traceparent?: string
	tracestate?: string
	baggage?: string
	requestId?: string
	sessionId?: string
	runtime?: Record<string, string | number | boolean | null | undefined>
	[key: string]: unknown
}

export interface Response<T = unknown> {
	result?: T
	error?: string | EnhancedError
}

export interface EnhancedError {
	name: string
	message: string
	stack?: string
	cause?: unknown
	[key: string]: unknown
}

export interface SerializationOptions {
	version?: "json" | "superjson"
}

export const TRANSFER_SLOT_PREFIX = "__kkrpc_transfer_"

export interface TransferSlot {
	type: "raw" | "handler"
	handlerName?: string
	metadata?: unknown
	/** Random per-slot token that proves a placeholder was generated for this message. */
	token?: string
}

export interface WireEnvelope {
	version: 2
	payload: Message<unknown>
	transferSlots?: TransferSlot[]
	encoding: "object"
	__transferredValues?: unknown[]
}

export type WireV1 = string
export type WireFormat = WireV1 | WireEnvelope

export type EncodedMessage =
	| { mode: "string"; data: string }
	| { mode: "structured"; data: WireEnvelope }

export interface RPCSerializationRuntime {
	encodeMessage<T>(
		message: Message<T>,
		options: SerializationOptions,
		withTransfers: boolean,
		transferredValues?: unknown[]
	): EncodedMessage
	decodeMessage<T>(raw: WireFormat): Promise<Message<T>>
	serializeError(error: Error): EnhancedError
	deserializeError(error: EnhancedError): Error
}
```

- [ ] **Step 4: Create `serialization-json.ts` from the existing JSON-safe logic**

Create `packages/kkrpc/src/serialization-json.ts` by moving the JSON-safe logic out of `serialization.ts`. The file must start with this module comment and must not import `superjson`:

```ts
/**
 * JSON-only kkrpc serialization runtime.
 * Browser-lite imports this module to keep SuperJSON out of the dependency graph
 * while preserving JSON string messages, structured envelopes, transfer slots,
 * and rich error serialization.
 */
```

The exports must include:

```ts
export {
	TRANSFER_SLOT_PREFIX,
	type EncodedMessage,
	type EnhancedError,
	type Message,
	type RPCMessageMetadata,
	type RPCSerializationRuntime,
	type Response,
	type SerializationOptions,
	type TransferSlot,
	type WireEnvelope,
	type WireFormat,
	type WireV1
} from "./serialization-types.ts"
```

Implement these public functions using the current code from `serialization.ts`:

```ts
export function serializeError(error: Error): EnhancedError
export function deserializeError(enhanced: EnhancedError): Error
export function encodeJsonMessage<T>(message: Message<T>): string
export function decodeJsonMessage<T>(message: string): Promise<Message<T>>
export function encodeStructuredMessage<T>(
	message: Message<T>,
	transferredValues?: unknown[]
): WireEnvelope
export function decodeStructuredMessage<T>(raw: WireEnvelope): Promise<Message<T>>
export function encodeMessage<T>(
	message: Message<T>,
	options: SerializationOptions,
	withTransfers: boolean,
	transferredValues?: unknown[]
): EncodedMessage
export async function decodeMessage<T>(raw: WireFormat): Promise<Message<T>>
export function processValueForTransfer(...): unknown
export function reconstructValueFromTransfer(...): unknown
export const jsonSerializationRuntime: RPCSerializationRuntime
```

Use the existing `replacer`, `reviver`, transfer placeholder, `processValueForTransfer`, and `reconstructValueFromTransfer` logic from `serialization.ts`. Keep the existing tagged placeholder object behavior from `origin/main`.

`decodeJsonMessage` must reject SuperJSON-looking strings before calling `JSON.parse`:

```ts
if (message.trimStart().startsWith('{"json":')) {
	throw new Error(
		'Received a SuperJSON-encoded kkrpc message, but this entrypoint is JSON-only. Use kkrpc/browser or configure both endpoints with serialization.version = "json".'
	)
}
```

`encodeMessage` in this module must reject SuperJSON options:

```ts
if (options.version === "superjson") {
	throw new Error(
		'SuperJSON serialization is not available in kkrpc/browser-lite. Use kkrpc/browser or configure both endpoints with serialization.version = "json".'
	)
}
```

`encodeStructuredMessage` and `decodeStructuredMessage` must not inspect `options.version`; they operate on object envelopes and are shared by the full serializer for transfer-capable transports.

- [ ] **Step 5: Run focused JSON serialization tests**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/serialization.test.ts
```

Expected: the new `JSON-only serialization` tests pass. Existing tests may still pass or may fail if `serialization.ts` has not yet been refactored; do not proceed until the new module compiles.

- [ ] **Step 6: Checkpoint**

If commits are explicitly requested:

```bash
git add packages/kkrpc/src/serialization-types.ts packages/kkrpc/src/serialization-json.ts packages/kkrpc/__tests__/serialization.test.ts
git commit -m "refactor(kkrpc): extract json serialization runtime"
```

### Task 2: Add Full Serializer And Preserve `serialization.ts`

**Files:**

- Create: `packages/kkrpc/src/serialization-full.ts`
- Modify: `packages/kkrpc/src/serialization.ts`
- Modify: `packages/kkrpc/__tests__/serialization.test.ts`

- [ ] **Step 1: Add compatibility test for existing `serialization.ts` imports**

Ensure `packages/kkrpc/__tests__/serialization.test.ts` still imports existing APIs from `../src/serialization.ts`:

```ts
import superjson from "superjson"
import { deserializeMessage, serializeMessage, type Message } from "../src/serialization.ts"
```

Add this test inside `describe("Serializer", ...)`:

```ts
test("default compatibility serializer still uses SuperJSON", async () => {
	const message: Message = {
		id: "superjson-default",
		method: "date.echo",
		args: [new Date("2026-06-05T00:00:00.000Z")],
		type: "request"
	}

	const serialized = serializeMessage(message)
	expect(serialized.startsWith('{"json":')).toBe(true)

	const deserialized = await deserializeMessage<unknown[]>(serialized)
	expect(deserialized.args[0]).toBeInstanceOf(Date)
})
```

- [ ] **Step 2: Run compatibility test and verify current behavior**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/serialization.test.ts
```

Expected: PASS before the refactor, or FAIL only because Task 1 imports are not yet wired. After Task 2 implementation this test must pass.

- [ ] **Step 3: Create `serialization-full.ts`**

Create `packages/kkrpc/src/serialization-full.ts`:

```ts
/**
 * Full kkrpc serialization runtime with SuperJSON support.
 * Existing package entrypoints import this module to preserve the current
 * default behavior for Date, Map, Set, BigInt, Uint8Array, and legacy messages.
 */

import superjson from "superjson"
import {
	decodeMessage as decodeJsonWireMessage,
	decodeStructuredMessage,
	deserializeError,
	encodeJsonMessage,
	encodeStructuredMessage,
	processValueForTransfer,
	reconstructValueFromTransfer,
	serializeError
} from "./serialization-json.ts"
import type {
	EncodedMessage,
	EnhancedError,
	Message,
	RPCSerializationRuntime,
	SerializationOptions,
	WireFormat
} from "./serialization-types.ts"

export type {
	EncodedMessage,
	EnhancedError,
	Message,
	RPCMessageMetadata,
	RPCSerializationRuntime,
	Response,
	SerializationOptions,
	TransferSlot,
	WireEnvelope,
	WireFormat,
	WireV1
} from "./serialization-types.ts"
export { deserializeError, processValueForTransfer, reconstructValueFromTransfer, serializeError }

export function serializeMessage<T>(
	message: Message<T>,
	options: SerializationOptions = {}
): string {
	const version = options.version || "superjson"
	const msgWithVersion = { ...message, version }
	return version === "json"
		? encodeJsonMessage(message)
		: superjson.stringify(msgWithVersion) + "\n"
}

export function deserializeMessage<T>(message: string): Promise<Message<T>> {
	return new Promise((resolve, reject) => {
		try {
			if (message.trimStart().startsWith('{"json":')) {
				resolve(superjson.parse<Message<T>>(message))
				return
			}
			decodeJsonWireMessage<T>(message).then(resolve, reject)
		} catch (error) {
			console.error("failed to parse message", typeof message, message, error)
			reject(error)
		}
	})
}

export function encodeMessage<T>(
	message: Message<T>,
	options: SerializationOptions,
	withTransfers: boolean,
	transferredValues: unknown[] = []
): EncodedMessage {
	if (!withTransfers) {
		return {
			mode: "string",
			data: serializeMessage(message, options)
		}
	}
	return {
		mode: "structured",
		data: encodeStructuredMessage(message, transferredValues)
	}
}

export async function decodeMessage<T>(raw: WireFormat): Promise<Message<T>> {
	if (typeof raw === "string") {
		return deserializeMessage<T>(raw)
	}
	return decodeStructuredMessage<T>(raw)
}

export const fullSerializationRuntime: RPCSerializationRuntime = {
	encodeMessage,
	decodeMessage,
	serializeError,
	deserializeError
}
```

This full serializer shares structured-envelope helpers with the JSON serializer, but it must not call the JSON serializer's generic `encodeMessage` with `version: "superjson"`.

- [ ] **Step 4: Replace `serialization.ts` with a compatibility barrel**

Replace `packages/kkrpc/src/serialization.ts` with:

```ts
/**
 * Compatibility exports for kkrpc's full serialization runtime.
 * Existing users import protocol types and helpers from this path, so it remains
 * SuperJSON-enabled. Browser-lite must import `serialization-json.ts` or
 * `serialization-types.ts` directly instead of this barrel.
 */

export * from "./serialization-types.ts"
export * from "./serialization-full.ts"
```

- [ ] **Step 5: Run serialization tests**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/serialization.test.ts
```

Expected: PASS. The default serializer still preserves `Date`; JSON-only serializer still rejects SuperJSON-looking strings.

- [ ] **Step 6: Run transfer tests**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/transfer.test.ts
```

Expected: PASS. Existing imports from `../src/serialization.ts` continue to expose transfer processing helpers.

- [ ] **Step 7: Checkpoint**

If commits are explicitly requested:

```bash
git add packages/kkrpc/src/serialization-full.ts packages/kkrpc/src/serialization.ts packages/kkrpc/__tests__/serialization.test.ts
git commit -m "refactor(kkrpc): keep full serialization compatibility"
```

### Task 3: Extract Channel Core And Add Full/Lite Wrappers

**Files:**

- Create: `packages/kkrpc/src/channel-core.ts`
- Modify: `packages/kkrpc/src/channel.ts`
- Create: `packages/kkrpc/src/channel-lite.ts`
- Create: `packages/kkrpc/__tests__/browser-lite.test.ts`

- [ ] **Step 1: Add failing lite RPC integration tests**

Create `packages/kkrpc/__tests__/browser-lite.test.ts`:

```ts
/**
 * Browser-lite integration tests.
 * These tests exercise the JSON-only RPCChannel wrapper without importing the
 * full SuperJSON-enabled channel facade.
 */

import { describe, expect, test } from "bun:test"
import { WebSocketServer } from "ws"
import { WebSocketClientIO, WebSocketServerIO } from "../src/adapters/websocket.ts"
import { RPCChannel } from "../src/channel-lite.ts"
import type { IoInterface } from "../src/interface.ts"

interface TestAPI {
	echo(message: string): Promise<string>
	add(a: number, b: number): Promise<number>
}

const testApi: TestAPI = {
	echo: async (message) => message,
	add: async (a, b) => a + b
}

describe("browser-lite RPCChannel", () => {
	test("calls remote methods with JSON serialization", async () => {
		const port = 3095
		const wss = new WebSocketServer({ port })
		wss.on("connection", (ws) => {
			const serverIO = new WebSocketServerIO(ws)
			new RPCChannel<TestAPI, {}>(serverIO, { expose: testApi })
		})

		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${port}` })
		const rpc = new RPCChannel<{}, TestAPI, IoInterface>(clientIO)
		const api = rpc.getAPI()

		try {
			expect(await api.echo("hello")).toBe("hello")
			expect(await api.add(2, 5)).toBe(7)
		} finally {
			clientIO.destroy()
			wss.close()
		}
	})

	test("rejects explicit SuperJSON serialization option", () => {
		const io = {
			name: "closed-test-io",
			read: async () => null,
			write: async () => {},
			on: () => {},
			off: () => {}
		} satisfies IoInterface

		expect(
			() =>
				new RPCChannel<{}, TestAPI, IoInterface>(io, {
					serialization: { version: "superjson" }
				})
		).toThrow("SuperJSON serialization is not available")
	})
})
```

- [ ] **Step 2: Run lite tests and verify they fail**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/browser-lite.test.ts
```

Expected: FAIL because `../src/channel-lite.ts` does not exist.

- [ ] **Step 3: Copy current channel implementation to `channel-core.ts`**

Run:

```bash
cp packages/kkrpc/src/channel.ts packages/kkrpc/src/channel-core.ts
```

Then edit the top of `packages/kkrpc/src/channel-core.ts`:

```ts
/**
 * Shared RPC channel state machine.
 * Public entrypoints wrap this class with a serialization runtime so lite
 * browser builds can avoid importing SuperJSON while full builds keep the
 * existing serialization behavior.
 */
```

Replace the serialization import with type imports from `serialization-types.ts` and runtime helpers only from the injected serializer:

```ts
import type {
	EnhancedError,
	Message,
	Response,
	RPCSerializationRuntime,
	SerializationOptions,
	TransferSlot
} from "./serialization-types.ts"
```

Keep these value imports from `serialization-json.ts` because transfer value processing is JSON/runtime-neutral and has no SuperJSON dependency:

```ts
import { processValueForTransfer, reconstructValueFromTransfer } from "./serialization-json.ts"
```

- [ ] **Step 4: Add shared channel options type**

In `channel-core.ts`, add this exported interface before the class:

```ts
export interface RPCChannelOptions<LocalAPI extends Record<string, any>> {
	expose?: LocalAPI
	serialization?: SerializationOptions
	enableTransfer?: boolean
	/** Optional validators for the exposed API. Validates inputs/outputs on the receiving side. */
	validators?: RPCValidators<LocalAPI>
	/** Interceptors that wrap handler invocation on the receiving side. */
	interceptors?: RPCInterceptor[]
	/** Timeout in ms for outgoing RPC calls. Default: 0 (no timeout). */
	timeout?: number
}
```

Change the class name and constructor:

```ts
export class RPCChannelCore<
	LocalAPI extends Record<string, any>,
	RemoteAPI extends Record<string, any>,
	Io extends IoInterface = IoInterface
> {
	constructor(
		private io: Io,
		options: RPCChannelOptions<LocalAPI> | undefined,
		private serializationRuntime: RPCSerializationRuntime
	) {
		this.apiImplementation = options?.expose
		this.validators = options?.validators
		this.interceptors = options?.interceptors ?? []
		this.timeout = options?.timeout ?? 0
		this.serializationOptions = options?.serialization || {}
		this.structuredClone = io.capabilities?.structuredClone === true
		if (
			this.structuredClone &&
			io.capabilities?.transfer === true &&
			options?.enableTransfer !== false
		) {
			this.supportsTransfer = true
		}
		this.listen()
	}
}
```

- [ ] **Step 5: Replace direct serializer calls inside `channel-core.ts`**

Replace calls as follows:

```ts
decodeMessage(payload)
```

becomes:

```ts
this.serializationRuntime.decodeMessage(payload)
```

```ts
decodeMessage(messageStr)
```

becomes:

```ts
this.serializationRuntime.decodeMessage(messageStr)
```

```ts
encodeMessage(message, this.serializationOptions, this.supportsTransfer, transferredValues)
```

becomes:

```ts
this.serializationRuntime.encodeMessage(
	message,
	this.serializationOptions,
	this.supportsTransfer,
	transferredValues
)
```

```ts
serializeError(error)
deserializeError(error)
```

become:

```ts
this.serializationRuntime.serializeError(error)
this.serializationRuntime.deserializeError(error)
```

Do not change request/response/callback logic in this task.

- [ ] **Step 6: Recreate `channel.ts` as the full wrapper**

Replace `packages/kkrpc/src/channel.ts` with:

```ts
import { RPCChannelCore, type RPCChannelOptions } from "./channel-core.ts"
import type { IoInterface } from "./interface.ts"
import { fullSerializationRuntime } from "./serialization-full.ts"

/**
 * Full kkrpc RPCChannel facade.
 * This entry keeps existing behavior by using the SuperJSON-enabled
 * serialization runtime.
 */

export { isRPCTimeoutError, RPCTimeoutError, type RPCChannelOptions } from "./channel-core.ts"

export class RPCChannel<
	LocalAPI extends Record<string, any>,
	RemoteAPI extends Record<string, any>,
	Io extends IoInterface = IoInterface
> extends RPCChannelCore<LocalAPI, RemoteAPI, Io> {
	constructor(io: Io, options?: RPCChannelOptions<LocalAPI>) {
		super(io, options, fullSerializationRuntime)
	}
}
```

- [ ] **Step 7: Add `channel-lite.ts` wrapper**

Create `packages/kkrpc/src/channel-lite.ts`:

```ts
import { RPCChannelCore, type RPCChannelOptions } from "./channel-core.ts"
import type { IoInterface } from "./interface.ts"
import { jsonSerializationRuntime } from "./serialization-json.ts"

/**
 * Browser-lite RPCChannel facade.
 * This wrapper preserves the public `new RPCChannel(...)` API while using the
 * JSON-only serialization runtime so SuperJSON stays out of lite bundles.
 */

export { isRPCTimeoutError, RPCTimeoutError, type RPCChannelOptions } from "./channel-core.ts"

export class RPCChannel<
	LocalAPI extends Record<string, any>,
	RemoteAPI extends Record<string, any>,
	Io extends IoInterface = IoInterface
> extends RPCChannelCore<LocalAPI, RemoteAPI, Io> {
	constructor(io: Io, options?: RPCChannelOptions<LocalAPI>) {
		if (options?.serialization?.version === "superjson") {
			throw new Error(
				'SuperJSON serialization is not available in kkrpc/browser-lite. Use kkrpc/browser or configure both endpoints with serialization.version = "json".'
			)
		}
		super(io, options, jsonSerializationRuntime)
	}
}
```

- [ ] **Step 8: Run lite and core tests**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/browser-lite.test.ts __tests__/serialization.test.ts __tests__/middleware.test.ts __tests__/timeout.test.ts
```

Expected: PASS. If TypeScript complains about `RPCChannelCore` generics, update the wrapper generic constraints to exactly match the current `RPCChannel` constraints.

- [ ] **Step 9: Checkpoint**

If commits are explicitly requested:

```bash
git add packages/kkrpc/src/channel-core.ts packages/kkrpc/src/channel.ts packages/kkrpc/src/channel-lite.ts packages/kkrpc/__tests__/browser-lite.test.ts
git commit -m "refactor(kkrpc): split channel core from serializer facade"
```

### Task 4: Add Browser Lite Entrypoint And Package Exports

**Files:**

- Create: `packages/kkrpc/browser-lite-mod.ts`
- Modify: `packages/kkrpc/tsdown.config.ts`
- Modify: `packages/kkrpc/package.json`
- Modify: `packages/kkrpc/deno.json`

- [ ] **Step 1: Add `browser-lite-mod.ts`**

Create `packages/kkrpc/browser-lite-mod.ts`:

```ts
/**
 * @module @kunkun/kkrpc/browser-lite
 * @description Browser-only kkrpc entrypoint that avoids static SuperJSON imports.
 */

export * from "./src/adapters/worker.ts"
export * from "./src/adapters/iframe.ts"
export * from "./src/adapters/websocket.ts"
export * from "./src/adapters/tauri.ts"
export * from "./src/interface.ts"
export * from "./src/channel-lite.ts"
export * from "./src/utils.ts"
export * from "./src/serialization-json.ts"
export * from "./src/serialization-types.ts"
export * from "./src/transfer.ts"
export * from "./src/transfer-handlers.ts"
export * from "./src/standard-schema.ts"
export * from "./src/validation.ts"
export * from "./src/middleware.ts"
```

- [ ] **Step 2: Add tsdown entry**

Modify `packages/kkrpc/tsdown.config.ts` entry array:

```ts
entry: [
	"./mod.ts",
	"./browser-mod.ts",
	"./browser-lite-mod.ts",
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
]
```

- [ ] **Step 3: Add package export**

In `packages/kkrpc/package.json`, add this export object after `./browser`:

```json
"./browser-lite": {
	"import": {
		"types": "./dist/browser-lite-mod.d.ts",
		"default": "./dist/browser-lite-mod.js"
	},
	"require": {
		"types": "./dist/browser-lite-mod.d.cts",
		"default": "./dist/browser-lite-mod.cjs"
	}
}
```

- [ ] **Step 4: Add Deno export**

In `packages/kkrpc/deno.json`, add:

```json
"./browser-lite": "./browser-lite-mod.ts"
```

Keep the JSON object valid with correct commas.

- [ ] **Step 5: Build package**

Run:

```bash
pnpm --filter kkrpc build
```

Expected: PASS and generates:

```txt
packages/kkrpc/dist/browser-lite-mod.js
packages/kkrpc/dist/browser-lite-mod.cjs
packages/kkrpc/dist/browser-lite-mod.d.ts
packages/kkrpc/dist/browser-lite-mod.d.cts
```

- [ ] **Step 6: Checkpoint**

If commits are explicitly requested:

```bash
git add packages/kkrpc/browser-lite-mod.ts packages/kkrpc/tsdown.config.ts packages/kkrpc/package.json packages/kkrpc/deno.json
git commit -m "feat(kkrpc): add browser-lite entrypoint"
```

### Task 5: Add Bundle Verification Script Using tsdown Output

**Files:**

- Create: `packages/kkrpc/scripts/check-browser-lite-bundle.ts`
- Modify: `packages/kkrpc/package.json`

- [ ] **Step 1: Create bundle check script**

Create `packages/kkrpc/scripts/check-browser-lite-bundle.ts`:

```ts
/**
 * Verifies that the tsdown-built browser-lite artifacts do not include
 * SuperJSON or its known dependency strings. This uses the canonical dist
 * output instead of adding another bundler to the project.
 */

import { readFile } from "node:fs/promises"
import { join } from "node:path"

const files = [
	"dist/browser-lite-mod.js",
	"dist/browser-lite-mod.cjs",
	"dist/browser-lite-mod.d.ts",
	"dist/browser-lite-mod.d.cts"
]

const forbidden = ["superjson", "copy-anything", "is-what"]
let failed = false

for (const file of files) {
	const path = join(import.meta.dir, "..", file)
	const contents = await readFile(path, "utf8")
	for (const token of forbidden) {
		if (contents.toLowerCase().includes(token)) {
			console.error(`[browser-lite-bundle] Found forbidden token ${token} in ${file}`)
			failed = true
		}
	}
}

if (failed) {
	process.exit(1)
}

console.log("[browser-lite-bundle] No SuperJSON dependency strings found")
```

- [ ] **Step 2: Add package script**

In `packages/kkrpc/package.json`, add:

```json
"check:browser-lite-bundle": "pnpm build && bun run scripts/check-browser-lite-bundle.ts"
```

Keep scripts sorted near existing `build`/`check-types` scripts if possible.

- [ ] **Step 3: Run bundle check**

Run:

```bash
pnpm --filter kkrpc check:browser-lite-bundle
```

Expected:

```txt
[browser-lite-bundle] No SuperJSON dependency strings found
```

- [ ] **Step 4: Checkpoint**

If commits are explicitly requested:

```bash
git add packages/kkrpc/scripts/check-browser-lite-bundle.ts packages/kkrpc/package.json
git commit -m "test(kkrpc): verify browser-lite bundle excludes superjson"
```

### Task 6: Document Browser Lite Usage

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add README section**

In `README.md`, add this section near the browser import guidance:

````md
### Browser Lite Entry

For browser-only apps that do not need SuperJSON, use the lite entrypoint:

```ts
import { RPCChannel, WorkerParentIO } from "kkrpc/browser-lite"
```
````

`kkrpc/browser-lite` keeps the same `RPCChannel` facade as `kkrpc/browser`, but uses JSON-only string serialization and structured-clone envelopes for transports that support object messages. It does not statically import SuperJSON, which keeps browser bundles smaller.

Use `kkrpc/browser` instead when you need SuperJSON-specific value preservation over string transports, such as Date, Map, Set, BigInt, or richer non-JSON values.

When mixing full and lite endpoints over string transports, configure the full endpoint with JSON serialization:

```ts
new RPCChannel(io, {
	serialization: { version: "json" }
})
```

Lite endpoints reject `serialization: { version: "superjson" }` with a clear runtime error.

````

Ensure nested code fences are valid Markdown. If this section is placed inside an existing fenced block, close that block first.

- [ ] **Step 2: Run markdown formatting**

Run:

```bash
pnpm format -- README.md
````

Expected: README formatting completes without errors.

- [ ] **Step 3: Checkpoint**

If commits are explicitly requested:

```bash
git add README.md
git commit -m "docs(kkrpc): document browser-lite entrypoint"
```

### Task 7: Full Verification

**Files:**

- Verify entire `packages/kkrpc` package

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/serialization.test.ts __tests__/transfer.test.ts __tests__/browser-lite.test.ts __tests__/middleware.test.ts __tests__/timeout.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run package typecheck**

Run:

```bash
pnpm --filter kkrpc check-types
```

Expected: PASS.

- [ ] **Step 3: Run package build**

Run:

```bash
pnpm --filter kkrpc build
```

Expected: PASS.

- [ ] **Step 4: Run browser-lite bundle check**

Run:

```bash
pnpm --filter kkrpc check:browser-lite-bundle
```

Expected:

```txt
[browser-lite-bundle] No SuperJSON dependency strings found
```

- [ ] **Step 5: Inspect git diff**

Run:

```bash
git status --short
git diff --stat
git diff -- packages/kkrpc/src/channel.ts packages/kkrpc/src/channel-core.ts packages/kkrpc/src/channel-lite.ts packages/kkrpc/src/serialization.ts packages/kkrpc/src/serialization-json.ts packages/kkrpc/src/serialization-full.ts packages/kkrpc/browser-lite-mod.ts
```

Expected: only intended files changed. Confirm `browser-lite` dependency path does not import `serialization.ts`, `serialization-full.ts`, or `superjson`.

- [ ] **Step 6: Final checkpoint**

If commits are explicitly requested:

```bash
git add packages/kkrpc README.md
git commit -m "feat(kkrpc): add superjson-free browser lite entry"
```

Do not commit generated `dist/` or `docs/` Typedoc output unless the repository convention explicitly requires generated artifacts for release.

## Self-Review Checklist

- Spec coverage: Implements serializer split, full compatibility, browser-lite export, tsdown verification, docs, and tests.
- Placeholder scan: No unresolved placeholder steps; broad edits use concrete copy/replace instructions and exact file paths.
- Type consistency: `RPCSerializationRuntime`, `SerializationOptions`, `Message`, `EnhancedError`, and `RPCChannelOptions` names are consistent across tasks.
- Scope: Focused on issue #24 and the agreed architecture. Does not split validation/middleware/transfer helpers beyond necessary exports.
