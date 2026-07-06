# next2main Native Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the current vNext RPC architecture to the stable `kkrpc` API and remove the classic `IoInterface` architecture from package exports, source, tests, examples, docs, and skills.

**Architecture:** The stable core is `Transport<RPCMessage>`-based, browser-safe, and exported from `kkrpc`. Runtime transports and optional-peer features live behind subpaths such as `kkrpc/stdio`, `kkrpc/http`, `kkrpc/ws`, `kkrpc/ws/hono`, `kkrpc/ws/elysia`, `kkrpc/electron`, and message-bus entries. Each transport family is migrated in its own testable slice, then old API remnants are removed with explicit grep and package-export gates.

**Tech Stack:** TypeScript, Bun test runner, Deno tests, tsdown package build, verify-package-export, optional peer dependencies for Hono, Elysia, Socket.IO, RabbitMQ, Kafka, Redis Streams, NATS, Electron, and Tauri.

---

## File Structure

Core files:

- Create: `packages/kkrpc/src/core/index.ts` for stable `RPCChannel`, `wrap`, `expose`, `dispose`, `transfer`, and core type exports.
- Create: `packages/kkrpc/src/core/channel.ts` from `packages/kkrpc/src/next/channel.ts`.
- Create: `packages/kkrpc/src/core/protocol.ts` from `packages/kkrpc/src/next/protocol.ts`.
- Create: `packages/kkrpc/src/core/transport.ts` from `packages/kkrpc/src/next/transport.ts`.
- Create: `packages/kkrpc/src/core/codecs.ts` from `packages/kkrpc/src/next/codecs.ts`.
- Create: `packages/kkrpc/src/core/plugins.ts` from `packages/kkrpc/src/next/plugins.ts`.
- Create: `packages/kkrpc/src/core/transfer.ts` from `packages/kkrpc/src/transfer.ts`, adjusted to core imports only.
- Create: `packages/kkrpc/src/core/utils.ts` for still-used core helpers such as request id generation.
- Delete after replacements: `packages/kkrpc/src/next/index.ts`, `packages/kkrpc/src/next/channel.ts`, `packages/kkrpc/src/next/protocol.ts`, `packages/kkrpc/src/next/transport.ts`, `packages/kkrpc/src/next/codecs.ts`, `packages/kkrpc/src/next/plugins.ts`, `packages/kkrpc/src/next/classic-compat.ts`, `packages/kkrpc/src/next/io.ts`.
- Delete after replacements: `packages/kkrpc/src/channel.ts`, `packages/kkrpc/src/interface.ts`, `packages/kkrpc/src/serialization.ts`, `packages/kkrpc/src/transfer-handlers.ts` unless redesigned with native tests.

Feature files:

- Create: `packages/kkrpc/src/features/validation.ts` from `packages/kkrpc/src/next/validation.ts` plus any required Standard Schema helpers.
- Create: `packages/kkrpc/src/features/middleware.ts` from `packages/kkrpc/src/next/middleware.ts`.
- Create: `packages/kkrpc/src/features/superjson.ts` from `packages/kkrpc/src/next/superjson.ts`.
- Delete after replacements: `packages/kkrpc/src/validation.ts`, `packages/kkrpc/src/middleware.ts`, `packages/kkrpc/src/standard-schema.ts` if all needed logic moved feature-local.

Transport files:

- Create: `packages/kkrpc/src/transports/worker.ts` from `packages/kkrpc/src/next/worker.ts`.
- Create: `packages/kkrpc/src/transports/stdio.ts` from `packages/kkrpc/src/next/stdio.ts`, expanded for Node/Bun/Deno helpers.
- Create: `packages/kkrpc/src/transports/http.ts` for unary HTTP client transport and request handler.
- Create: `packages/kkrpc/src/transports/ws.ts` for plain WebSocket transports.
- Create: `packages/kkrpc/src/transports/ws-hono.ts` for Hono WebSocket helpers.
- Create: `packages/kkrpc/src/transports/ws-elysia.ts` for Elysia WebSocket helpers.
- Create: `packages/kkrpc/src/transports/socketio.ts` for Socket.IO transports.
- Create: `packages/kkrpc/src/transports/iframe.ts` for iframe `postMessage` transport.
- Create: `packages/kkrpc/src/transports/chrome-extension.ts` for Chrome extension port transport.
- Create: `packages/kkrpc/src/transports/electron.ts` for Electron utility-process and IPC transports.
- Create: `packages/kkrpc/src/transports/tauri.ts` for Tauri shell stdio transport.
- Create: `packages/kkrpc/src/transports/bus-envelope.ts` for shared bus envelope helpers.
- Create: `packages/kkrpc/src/transports/rabbitmq.ts` for RabbitMQ transport.
- Create: `packages/kkrpc/src/transports/kafka.ts` for Kafka transport.
- Create: `packages/kkrpc/src/transports/redis-streams.ts` for Redis Streams transport.
- Create: `packages/kkrpc/src/transports/nats.ts` for NATS transport.
- Delete after replacements: `packages/kkrpc/src/adapters/*.ts` classic adapters.

Entry files:

- Modify: `packages/kkrpc/mod.ts` to export only stable core from `src/core/index.ts`.
- Modify: `packages/kkrpc/browser-mod.ts` to export stable core plus browser-safe transports.
- Modify: `packages/kkrpc/deno-mod.ts` to export stable core plus Deno-safe transports.
- Modify: `packages/kkrpc/http.ts`, `packages/kkrpc/chrome-extension.ts`, `packages/kkrpc/socketio.ts`, `packages/kkrpc/rabbitmq.ts`, `packages/kkrpc/kafka.ts`, `packages/kkrpc/redis-streams.ts`, `packages/kkrpc/nats.ts`, `packages/kkrpc/electron.ts`, `packages/kkrpc/inspector.ts` to re-export native stable files.
- Create: `packages/kkrpc/transport.ts`, `packages/kkrpc/codecs.ts`, `packages/kkrpc/plugins.ts`, `packages/kkrpc/validation.ts`, `packages/kkrpc/middleware.ts`, `packages/kkrpc/superjson.ts`, `packages/kkrpc/worker.ts`, `packages/kkrpc/stdio.ts`, `packages/kkrpc/ws.ts`, `packages/kkrpc/ws-hono.ts`, `packages/kkrpc/ws-elysia.ts`, `packages/kkrpc/iframe.ts`, `packages/kkrpc/tauri.ts`, `packages/kkrpc/relay.ts`.
- Delete after replacements: `packages/kkrpc/next*.ts`, `packages/kkrpc/browser-lite-mod.ts`, `packages/kkrpc/browser-mini-mod.ts`, `packages/kkrpc/electron-ipc.ts`.

Package and build files:

- Modify: `packages/kkrpc/package.json` exports and scripts.
- Modify: `packages/kkrpc/tsdown.config.ts` entry list and externals.
- Modify: `packages/kkrpc/scripts/compare-browser-bundle-size.ts` to measure stable entries.
- Modify: `packages/kkrpc/scripts/check-browser-lite-bundle.ts` or delete it with the `check:browser-lite-bundle` script.

Test files:

- Rename or recreate `packages/kkrpc/__tests__/next-core.test.ts` as `packages/kkrpc/__tests__/core.test.ts`.
- Rename or recreate `packages/kkrpc/__tests__/next-transport-codecs.test.ts` as `packages/kkrpc/__tests__/transport-codecs.test.ts`.
- Rename or recreate `packages/kkrpc/__tests__/next-validation.test.ts` as `packages/kkrpc/__tests__/validation.test.ts`.
- Rename or recreate `packages/kkrpc/__tests__/next-middleware.test.ts` as `packages/kkrpc/__tests__/middleware.test.ts`.
- Rename or recreate `packages/kkrpc/__tests__/next-superjson.test.ts` as `packages/kkrpc/__tests__/superjson.test.ts`.
- Rename or recreate `packages/kkrpc/__tests__/next-worker.test.ts` as `packages/kkrpc/__tests__/worker.test.ts`.
- Rename or recreate `packages/kkrpc/__tests__/next-stdio.test.ts` as `packages/kkrpc/__tests__/stdio.test.ts`.
- Delete `packages/kkrpc/__tests__/next-classic-compat.test.ts` and `packages/kkrpc/__tests__/next-io.test.ts`.
- Rewrite classic transport tests in `packages/kkrpc/__tests__/*.test.ts` to stable native imports.
- Add: `packages/kkrpc/__tests__/package-exports.test.ts` for removed and stable exports.
- Add: `packages/kkrpc/__tests__/browser-boundary.test.ts` for browser bundle safety.

Examples and docs:

- Modify every `examples/**` source file and README to use stable native imports.
- Modify `skills/kkrpc/SKILL.md` to remove `kkrpc/next`, `classic-compat`, `next/io`, and old `*IO` patterns.
- Rename or replace `packages/kkrpc/NEXT_ARCHITECTURE.md` with `packages/kkrpc/ARCHITECTURE.md`.
- Replace `packages/kkrpc/NEXT_MIGRATION.md` with `packages/kkrpc/BREAKING_MIGRATION.md` or delete it if the package docs cover the migration.

---

### Task 1: Stable Core Export And Removed Export Tests

**Files:**

- Create: `packages/kkrpc/__tests__/package-exports.test.ts`
- Create: `packages/kkrpc/src/core/index.ts`
- Create: `packages/kkrpc/src/core/channel.ts`
- Create: `packages/kkrpc/src/core/protocol.ts`
- Create: `packages/kkrpc/src/core/transport.ts`
- Create: `packages/kkrpc/src/core/plugins.ts`
- Create: `packages/kkrpc/src/core/transfer.ts`
- Create: `packages/kkrpc/src/core/utils.ts`
- Modify: `packages/kkrpc/mod.ts`
- Modify: `packages/kkrpc/package.json`
- Modify: `packages/kkrpc/tsdown.config.ts`
- Test: `packages/kkrpc/__tests__/package-exports.test.ts`

- [ ] **Step 1: Write failing package export tests**

Create `packages/kkrpc/__tests__/package-exports.test.ts`:

```ts
import { describe, expect, test } from "bun:test"

describe("stable package exports", () => {
	test("main entry exposes stable core API", async () => {
		const core = await import("../mod.ts")

		expect(typeof core.RPCChannel).toBe("function")
		expect(typeof core.wrap).toBe("function")
		expect(typeof core.expose).toBe("function")
		expect(typeof core.dispose).toBe("function")
		expect(typeof core.transfer).toBe("function")
		expect("IoInterface" in core).toBe(false)
	})

	test("removed next and experiment entries are absent from package exports", async () => {
		const packageJson = await import("../package.json")
		const exportsMap = packageJson.default.exports as Record<string, unknown>

		expect(exportsMap["./next"]).toBeUndefined()
		expect(Object.keys(exportsMap).some((key) => key.startsWith("./next/"))).toBe(false)
		expect(exportsMap["./browser-lite"]).toBeUndefined()
		expect(exportsMap["./browser-mini"]).toBeUndefined()
		expect(exportsMap["./electron-ipc"]).toBeUndefined()
	})

	test("stable feature entries are present", async () => {
		const packageJson = await import("../package.json")
		const exportsMap = packageJson.default.exports as Record<string, unknown>

		for (const key of [
			"./browser",
			"./deno",
			"./transport",
			"./codecs",
			"./plugins",
			"./validation",
			"./middleware",
			"./superjson",
			"./worker",
			"./stdio",
			"./http",
			"./ws",
			"./ws/hono",
			"./ws/elysia",
			"./iframe",
			"./chrome-extension",
			"./electron",
			"./tauri",
			"./socketio",
			"./rabbitmq",
			"./kafka",
			"./redis-streams",
			"./nats",
			"./relay",
			"./inspector"
		]) {
			expect(exportsMap[key], key).toBeDefined()
		}
	})
})
```

- [ ] **Step 2: Run package export tests and verify they fail**

Run from `packages/kkrpc`:

```bash
bun test __tests__/package-exports.test.ts
```

Expected: FAIL because `../mod.ts` still exports classic API and package exports still include `./next`, `./browser-lite`, `./browser-mini`, and `./electron-ipc`.

- [ ] **Step 3: Move vNext core files into `src/core`**

Use `apply_patch` to add files with the current content from `packages/kkrpc/src/next/channel.ts`, `protocol.ts`, `transport.ts`, and `plugins.ts`. Update relative imports from `./*.ts` to the new `src/core` locations. Add `packages/kkrpc/src/core/transfer.ts` from `packages/kkrpc/src/transfer.ts` and update references to import from `./transfer.ts`.

Create `packages/kkrpc/src/core/index.ts` with stable imports:

```ts
import { RPCChannel } from "./channel.ts"
import type { RPCChannelOptions } from "./channel.ts"
import type { RPCMessage } from "./protocol.ts"
import type { Transport } from "./transport.ts"

export { RPCChannel }
export type { RPCChannelOptions } from "./channel.ts"
export { transfer } from "./transfer.ts"
export type { TransferDescriptor } from "./transfer.ts"
export type {
	RPCErrorContext,
	RPCHandlerContext,
	RPCPlugin,
	RPCRequestContext,
	RPCResponseContext
} from "./plugins.ts"
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

export interface ExposedController<
	LocalAPI extends object = object,
	RemoteAPI extends object = object
> {
	channel: RPCChannel<LocalAPI, RemoteAPI>
	dispose(): void
}

const channels = new WeakMap<object, RPCChannel<object, object>>()

export function wrap<RemoteAPI extends object = object>(
	transport: Transport<RPCMessage>,
	options: Omit<RPCChannelOptions<object>, "expose"> = {}
): RemoteAPI {
	const channel = new RPCChannel<object, RemoteAPI>(transport, options)
	const api = channel.getAPI()
	channels.set(api, channel as RPCChannel<object, object>)
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
	const channel = channels.get(api)
	if (!channel) return
	channels.delete(api)
	channel.destroy()
}
```

- [ ] **Step 4: Point main entry at stable core**

Replace `packages/kkrpc/mod.ts` with:

```ts
/**
 * @module kkrpc
 * @description Stable core RPC entry. Runtime transports and optional features live in subpaths.
 */
export * from "./src/core/index.ts"
```

- [ ] **Step 5: Update package exports and build entries for stable core**

Modify `packages/kkrpc/package.json`:

- Remove `./next`, `./next/*`, `./browser-lite`, `./browser-mini`, and `./electron-ipc`.
- Add stable subpaths listed by `package-exports.test.ts`.
- Keep `.` pointing to `./dist/mod.js` and `./dist/mod.d.ts`.

Modify `packages/kkrpc/tsdown.config.ts` entry array:

```ts
entry: [
	"./mod.ts",
	"./browser-mod.ts",
	"./deno-mod.ts",
	"./transport.ts",
	"./codecs.ts",
	"./plugins.ts",
	"./validation.ts",
	"./middleware.ts",
	"./superjson.ts",
	"./worker.ts",
	"./stdio.ts",
	"./http.ts",
	"./ws.ts",
	"./ws-hono.ts",
	"./ws-elysia.ts",
	"./iframe.ts",
	"./chrome-extension.ts",
	"./electron.ts",
	"./tauri.ts",
	"./socketio.ts",
	"./rabbitmq.ts",
	"./kafka.ts",
	"./redis-streams.ts",
	"./nats.ts",
	"./relay.ts",
	"./inspector.ts"
]
```

- [ ] **Step 6: Add temporary stable entry stubs that re-export existing next modules**

Create these wrappers so export tests can pass before all transport rewrites are complete:

```ts
// packages/kkrpc/transport.ts
export * from "./src/core/transport.ts"
```

```ts
// packages/kkrpc/plugins.ts
export * from "./src/core/plugins.ts"
```

For wrappers not implemented yet, export from existing `src/next` modules when available or create empty typed stubs with no old API exports. Replace every temporary stub in later tasks before final verification.

- [ ] **Step 7: Run package export tests and typecheck**

Run from `packages/kkrpc`:

```bash
bun test __tests__/package-exports.test.ts
pnpm check-types
```

Expected: PASS for the new package export tests and typecheck for touched core files.

- [ ] **Step 8: Commit stable core export slice**

```bash
git add packages/kkrpc
git commit -m "feat(kkrpc): promote next core to stable entry"
```

---

### Task 2: Stable Core, Codec, Plugin, Validation, Middleware, And SuperJSON Tests

**Files:**

- Modify: `packages/kkrpc/__tests__/core.test.ts`
- Modify: `packages/kkrpc/__tests__/transport-codecs.test.ts`
- Modify: `packages/kkrpc/__tests__/validation.test.ts`
- Modify: `packages/kkrpc/__tests__/middleware.test.ts`
- Modify: `packages/kkrpc/__tests__/superjson.test.ts`
- Modify: `packages/kkrpc/src/features/validation.ts`
- Modify: `packages/kkrpc/src/features/middleware.ts`
- Modify: `packages/kkrpc/src/features/superjson.ts`
- Modify: `packages/kkrpc/validation.ts`
- Modify: `packages/kkrpc/middleware.ts`
- Modify: `packages/kkrpc/superjson.ts`
- Delete: `packages/kkrpc/__tests__/next-classic-compat.test.ts`
- Delete: `packages/kkrpc/__tests__/next-io.test.ts`

- [ ] **Step 1: Rename next tests to stable test names**

Use `git mv` or `apply_patch` equivalent:

```bash
git mv packages/kkrpc/__tests__/next-core.test.ts packages/kkrpc/__tests__/core.test.ts
git mv packages/kkrpc/__tests__/next-transport-codecs.test.ts packages/kkrpc/__tests__/transport-codecs.test.ts
git mv packages/kkrpc/__tests__/next-validation.test.ts packages/kkrpc/__tests__/validation.test.ts
git mv packages/kkrpc/__tests__/next-middleware.test.ts packages/kkrpc/__tests__/middleware.test.ts
git mv packages/kkrpc/__tests__/next-superjson.test.ts packages/kkrpc/__tests__/superjson.test.ts
```

If `git mv` is not available in the execution context, use `apply_patch` to add the new files and delete the old files.

- [ ] **Step 2: Update stable test imports**

Replace imports in renamed tests:

```ts
import { dispose, expose, RPCChannel, transfer, wrap } from "../mod.ts"
import type { RPCMessage, Transport } from "../mod.ts"
```

```ts
import { jsonCodec, jsonLineCodec, objectCodec } from "../codecs.ts"
import { createTransport, type Platform } from "../transport.ts"
```

```ts
import {
	defineAPI,
	defineMethod,
	extractValidators,
	isRPCValidationError,
	validationPlugin
} from "../validation.ts"
```

```ts
import { middlewarePlugin } from "../middleware.ts"
```

```ts
import { superjsonCodec, superjsonLineCodec } from "../superjson.ts"
```

- [ ] **Step 3: Move feature files and update wrappers**

Create `packages/kkrpc/src/features/validation.ts`, `middleware.ts`, and `superjson.ts` from their `src/next` equivalents. Update imports to `../core/*.ts`.

Create wrappers:

```ts
// packages/kkrpc/validation.ts
export * from "./src/features/validation.ts"
```

```ts
// packages/kkrpc/middleware.ts
export * from "./src/features/middleware.ts"
```

```ts
// packages/kkrpc/superjson.ts
export * from "./src/features/superjson.ts"
```

- [ ] **Step 4: Delete compatibility tests and wrappers**

Delete:

```text
packages/kkrpc/__tests__/next-classic-compat.test.ts
packages/kkrpc/__tests__/next-io.test.ts
packages/kkrpc/next-classic-compat.ts
packages/kkrpc/next-io.ts
packages/kkrpc/src/next/classic-compat.ts
packages/kkrpc/src/next/io.ts
```

- [ ] **Step 5: Run focused stable core and feature tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/core.test.ts __tests__/transport-codecs.test.ts __tests__/validation.test.ts __tests__/middleware.test.ts __tests__/superjson.test.ts __tests__/package-exports.test.ts
pnpm check-types
```

Expected: PASS. Any failure mentioning `kkrpc/next`, `next-`, `classic-compat`, or `ioTransport` must be fixed by replacing imports or deleting compatibility-only coverage.

- [ ] **Step 6: Commit stable core and feature tests**

```bash
git add packages/kkrpc
git commit -m "test(kkrpc): migrate core feature tests to stable api"
```

---

### Task 3: Worker And stdio Native Transports

**Files:**

- Create: `packages/kkrpc/src/transports/worker.ts`
- Create: `packages/kkrpc/src/transports/stdio.ts`
- Create: `packages/kkrpc/worker.ts`
- Create: `packages/kkrpc/stdio.ts`
- Modify: `packages/kkrpc/__tests__/worker.test.ts`
- Modify: `packages/kkrpc/__tests__/stdio.test.ts`
- Modify: `packages/kkrpc/__deno_tests__/*.ts`
- Modify: `packages/kkrpc/browser-mod.ts`
- Modify: `packages/kkrpc/deno-mod.ts`

- [ ] **Step 1: Rename next transport tests**

Rename:

```bash
git mv packages/kkrpc/__tests__/next-worker.test.ts packages/kkrpc/__tests__/worker.test.ts
git mv packages/kkrpc/__tests__/next-stdio.test.ts packages/kkrpc/__tests__/stdio.test.ts
```

- [ ] **Step 2: Write failing stable import assertions**

In `packages/kkrpc/__tests__/worker.test.ts`, imports must be:

```ts
import { expose, wrap } from "../mod.ts"
import { workerSelfTransport, workerTransport } from "../worker.ts"
```

In `packages/kkrpc/__tests__/stdio.test.ts`, imports must be:

```ts
import { expose, wrap } from "../mod.ts"
import { nodeStdioTransport, stdioJsonTransport, stdioPlatform } from "../stdio.ts"
```

Run from `packages/kkrpc`:

```bash
bun test __tests__/worker.test.ts __tests__/stdio.test.ts
```

Expected: FAIL until `worker.ts` and `stdio.ts` wrappers point to native transports.

- [ ] **Step 3: Implement native Worker wrapper**

Create `packages/kkrpc/src/transports/worker.ts` from `src/next/worker.ts` with imports from `../core/protocol.ts` and `../core/transport.ts`.

Create `packages/kkrpc/worker.ts`:

```ts
export * from "./src/transports/worker.ts"
```

- [ ] **Step 4: Implement native stdio wrapper**

Create `packages/kkrpc/src/transports/stdio.ts` from `src/next/stdio.ts` with imports from `../core/codecs.ts`, `../core/protocol.ts`, and `../core/transport.ts`.

Create `packages/kkrpc/stdio.ts`:

```ts
export * from "./src/transports/stdio.ts"
```

- [ ] **Step 5: Update browser and Deno convenience entries**

Replace `packages/kkrpc/browser-mod.ts` with browser-safe exports:

```ts
export * from "./src/core/index.ts"
export * from "./src/transports/worker.ts"
```

Replace `packages/kkrpc/deno-mod.ts` with Deno-safe exports:

```ts
export * from "./src/core/index.ts"
export * from "./src/transports/worker.ts"
export * from "./src/transports/stdio.ts"
```

- [ ] **Step 6: Migrate Deno tests to stable imports**

In `packages/kkrpc/__deno_tests__/*.ts`, replace `../next.ts` with `../mod.ts`, replace `../next-worker.ts` with `../worker.ts`, and replace `../next-stdio.ts` with `../stdio.ts`.

- [ ] **Step 7: Run focused Worker, stdio, and Deno tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/worker.test.ts __tests__/stdio.test.ts
deno test --no-lock -R __deno_tests__
pnpm check-types
```

Expected: PASS.

- [ ] **Step 8: Commit Worker and stdio transports**

```bash
git add packages/kkrpc
git commit -m "feat(kkrpc): add stable worker and stdio transports"
```

---

### Task 4: Unary HTTP Native Transport And Example

**Files:**

- Create: `packages/kkrpc/src/transports/http.ts`
- Modify: `packages/kkrpc/http.ts`
- Rewrite: `packages/kkrpc/__tests__/http.test.ts`
- Modify: `examples/http-demo/client.ts`
- Modify: `examples/http-demo/client.test.ts`
- Modify: `examples/http-demo/README.md`

- [ ] **Step 1: Rewrite HTTP tests for unary semantics**

Replace `packages/kkrpc/__tests__/http.test.ts` with tests that use stable native API:

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHttpHandler, httpClientTransport } from "../http.ts"
import { wrap } from "../mod.ts"
import { apiMethods, type API } from "./scripts/api.ts"

describe("HTTP RPC", () => {
	let server: ReturnType<typeof Bun.serve>
	let api: API
	let baseUrl: string

	beforeAll(() => {
		const handler = createHttpHandler(apiMethods)
		server = Bun.serve({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url)
				if (url.pathname !== "/rpc") return new Response("Not found", { status: 404 })
				if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })
				return handler(req)
			}
		})
		baseUrl = `http://127.0.0.1:${server.port}`
		api = wrap<API>(httpClientTransport({ url: `${baseUrl}/rpc` }))
	})

	afterAll(() => {
		server.stop()
	})

	test("echo service", async () => {
		expect(await api.echo("Hello RPC!")).toBe("Hello RPC!")
	})

	test("math operations", async () => {
		expect(await api.math.grade1.add(5, 3)).toBe(8)
		expect(await api.math.grade2.multiply(4, 6)).toBe(24)
	})

	test("concurrent calls", async () => {
		const results = await Promise.all([
			api.math.grade1.add(10, 20),
			api.math.grade2.multiply(10, 20)
		])
		expect(results).toEqual([30, 200])
	})

	test("wrong method and wrong path stay HTTP errors", async () => {
		expect(await fetch(`${baseUrl}/invalid`).then((res) => res.status)).toBe(404)
		expect(await fetch(`${baseUrl}/rpc`, { method: "GET" }).then((res) => res.status)).toBe(405)
	})

	test("malformed request returns 400", async () => {
		const response = await fetch(`${baseUrl}/rpc`, { method: "POST", body: "not-json" })
		expect(response.status).toBe(400)
	})
})
```

- [ ] **Step 2: Run HTTP test and verify it fails**

Run from `packages/kkrpc`:

```bash
bun test __tests__/http.test.ts
```

Expected: FAIL because `createHttpHandler` and `httpClientTransport` are not implemented.

- [ ] **Step 3: Implement `httpClientTransport` and `createHttpHandler`**

Create `packages/kkrpc/src/transports/http.ts` with exports:

```ts
import { RPCChannel } from "../core/channel.ts"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export interface HttpClientTransportOptions {
	url: string
	headers?: Record<string, string>
	fetch?: typeof fetch
}

export interface HttpHandlerOptions {
	timeout?: number
}

export function httpClientTransport(options: HttpClientTransportOptions): Transport<RPCMessage> {
	const fetchImpl = options.fetch ?? fetch
	const listeners = new Set<(message: RPCMessage) => void>()

	return {
		capabilities: { objectMode: true, transfer: false },
		async send(message) {
			if (message.t !== "q") throw new Error("HTTP transport only supports client request messages")
			const response = await fetchImpl(options.url, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...options.headers },
				body: JSON.stringify(message)
			})
			if (!response.ok) throw new Error(`HTTP error ${response.status}`)
			const reply = (await response.json()) as RPCMessage
			for (const listener of listeners) listener(reply)
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		}
	}
}

export function createHttpHandler<LocalAPI extends object>(
	api: LocalAPI,
	options: HttpHandlerOptions = {}
): (request: Request) => Promise<Response> {
	return async (request) => {
		let message: RPCMessage
		try {
			message = (await request.json()) as RPCMessage
			if (message.t !== "q" || typeof message.id !== "string")
				throw new Error("invalid RPC request")
		} catch {
			return new Response("Bad request", { status: 400 })
		}

		const transport = createRequestScopedTransport(message)
		const channel = new RPCChannel<LocalAPI, object>(transport, {
			expose: api,
			timeout: options.timeout
		})

		try {
			const response = await transport.response
			return Response.json(response)
		} finally {
			channel.destroy()
		}
	}
}

function createRequestScopedTransport(
	request: RPCMessage
): Transport<RPCMessage> & { response: Promise<RPCMessage> } {
	let resolveResponse!: (message: RPCMessage) => void
	const response = new Promise<RPCMessage>((resolve) => {
		resolveResponse = resolve
	})

	return {
		response,
		capabilities: { objectMode: true, transfer: false },
		send(message) {
			resolveResponse(message)
		},
		subscribe(listener) {
			queueMicrotask(() => listener(request))
			return () => {}
		}
	}
}
```

Create `packages/kkrpc/http.ts`:

```ts
export * from "./src/transports/http.ts"
```

- [ ] **Step 4: Run HTTP tests and typecheck**

Run from `packages/kkrpc`:

```bash
bun test __tests__/http.test.ts
pnpm check-types
```

Expected: PASS. If TypeScript rejects `Response.json`, use `new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } })`.

- [ ] **Step 5: Migrate HTTP example**

Update `examples/http-demo/client.ts` to import from stable native entries:

```ts
import { wrap } from "kkrpc"
import { httpClientTransport } from "kkrpc/http"
```

Update the HTTP demo server file to create `createHttpHandler(api)` instead of `HTTPServerIO` and classic `RPCChannel`.

Update `examples/http-demo/client.test.ts` with the same native handler/client setup used in `packages/kkrpc/__tests__/http.test.ts`.

- [ ] **Step 6: Run HTTP example tests**

Run:

```bash
pnpm test
pnpm run check-types
```

from `examples/http-demo`.

Expected: PASS.

- [ ] **Step 7: Commit HTTP slice**

```bash
git add packages/kkrpc examples/http-demo
git commit -m "feat(kkrpc): add native unary http transport"
```

---

### Task 5: WebSocket, Hono, Elysia, And Socket.IO Native Transports

**Files:**

- Create: `packages/kkrpc/src/transports/ws.ts`
- Create: `packages/kkrpc/src/transports/ws-hono.ts`
- Create: `packages/kkrpc/src/transports/ws-elysia.ts`
- Create: `packages/kkrpc/src/transports/socketio.ts`
- Create: `packages/kkrpc/ws.ts`
- Create: `packages/kkrpc/ws-hono.ts`
- Create: `packages/kkrpc/ws-elysia.ts`
- Modify: `packages/kkrpc/socketio.ts`
- Rewrite: `packages/kkrpc/__tests__/websocket.test.ts`
- Rewrite: `packages/kkrpc/__tests__/hono-websocket.test.ts`
- Rewrite: `packages/kkrpc/__tests__/elysia-websocket.test.ts`
- Rewrite: `packages/kkrpc/__tests__/socketio.test.ts`

- [ ] **Step 1: Rewrite plain WebSocket test imports**

In `packages/kkrpc/__tests__/websocket.test.ts`, use:

```ts
import { RPCChannel } from "../mod.ts"
import { webSocketClientTransport, webSocketTransport } from "../ws.ts"
import { apiMethods, type API } from "./scripts/api.ts"
```

The test should create a real `WebSocketServer`, wrap each accepted socket with `webSocketTransport(socket)`, expose `apiMethods`, then create a client with `webSocketClientTransport({ url })` and call `client.getAPI<API>()`.

- [ ] **Step 2: Run WebSocket tests and verify failure**

Run from `packages/kkrpc`:

```bash
bun test __tests__/websocket.test.ts
```

Expected: FAIL because stable WebSocket transports are not implemented.

- [ ] **Step 3: Implement plain WebSocket transport**

Create `packages/kkrpc/src/transports/ws.ts` with a structural `WebSocketLike` and two factories:

```ts
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export interface WebSocketLike {
	send(data: string): void
	close(): void
	onmessage: ((event: { data: unknown }) => void) | null
	onerror?: ((event: unknown) => void) | null
	onclose?: ((event: unknown) => void) | null
}

export interface WebSocketClientTransportOptions {
	url: string
	protocols?: string | string[]
}

export function webSocketTransport(socket: WebSocketLike): Transport<RPCMessage> {
	const listeners = new Set<(message: RPCMessage) => void>()
	socket.onmessage = (event) => {
		const raw = typeof event.data === "string" ? event.data : String(event.data)
		const message = JSON.parse(raw) as RPCMessage
		for (const listener of listeners) listener(message)
	}

	return {
		capabilities: { objectMode: true, transfer: false },
		send(message) {
			socket.send(JSON.stringify(message))
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		close() {
			socket.close()
		}
	}
}

export function webSocketClientTransport(
	options: WebSocketClientTransportOptions
): Transport<RPCMessage> {
	return webSocketTransport(new WebSocket(options.url, options.protocols))
}
```

Create `packages/kkrpc/ws.ts`:

```ts
export * from "./src/transports/ws.ts"
```

- [ ] **Step 4: Implement Hono and Elysia wrappers under `kkrpc/ws/*`**

Create `packages/kkrpc/ws-hono.ts`:

```ts
export * from "./src/transports/ws-hono.ts"
```

Create `packages/kkrpc/ws-elysia.ts`:

```ts
export * from "./src/transports/ws-elysia.ts"
```

Implement framework helpers by adapting each framework socket to the same `Transport<RPCMessage>` shape and reusing the JSON parse/stringify WebSocket behavior. Keep imports of `hono` and `elysia` only inside these framework subpath files.

- [ ] **Step 5: Implement Socket.IO transport**

Create `packages/kkrpc/src/transports/socketio.ts` with factories using a single event name such as `"kkrpc:message"`:

```ts
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export interface SocketLike {
	emit(event: "kkrpc:message", message: RPCMessage): void
	on(event: "kkrpc:message", listener: (message: RPCMessage) => void): void
	off(event: "kkrpc:message", listener: (message: RPCMessage) => void): void
	disconnect?(): void
}

export function socketIoTransport(socket: SocketLike): Transport<RPCMessage> {
	return {
		capabilities: { objectMode: true, transfer: false },
		send(message) {
			socket.emit("kkrpc:message", message)
		},
		subscribe(listener) {
			socket.on("kkrpc:message", listener)
			return () => socket.off("kkrpc:message", listener)
		},
		close() {
			socket.disconnect?.()
		}
	}
}
```

Update `packages/kkrpc/socketio.ts`:

```ts
export * from "./src/transports/socketio.ts"
```

- [ ] **Step 6: Run WebSocket family tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/websocket.test.ts __tests__/hono-websocket.test.ts __tests__/elysia-websocket.test.ts __tests__/socketio.test.ts
pnpm check-types
```

Expected: PASS.

- [ ] **Step 7: Commit WebSocket family slice**

```bash
git add packages/kkrpc
git commit -m "feat(kkrpc): add native websocket transports"
```

---

### Task 6: Browser Context Transports And Browser Safety

**Files:**

- Create: `packages/kkrpc/src/transports/iframe.ts`
- Create: `packages/kkrpc/src/transports/chrome-extension.ts`
- Create: `packages/kkrpc/iframe.ts`
- Modify: `packages/kkrpc/chrome-extension.ts`
- Modify: `packages/kkrpc/browser-mod.ts`
- Add: `packages/kkrpc/__tests__/browser-boundary.test.ts`
- Rewrite: `packages/kkrpc/__tests__/bun.worker.test.ts`
- Rewrite examples: `examples/iframe-worker-demo/**`, `examples/chrome-extension/**`, `examples/transferable-browser/**`

- [ ] **Step 1: Add browser boundary smoke test**

Create `packages/kkrpc/__tests__/browser-boundary.test.ts`:

```ts
import { describe, expect, test } from "bun:test"

const forbidden = [
	"node:",
	"ws",
	"hono",
	"elysia",
	"socket.io",
	"amqplib",
	"kafkajs",
	"ioredis",
	"@nats-io/transport-node",
	"@tauri-apps/plugin-shell"
]

describe("browser-safe entries", () => {
	test("main entry bundles without optional peer dependencies", async () => {
		const output = await Bun.build({
			entrypoints: [new URL("../mod.ts", import.meta.url).pathname],
			target: "browser",
			format: "esm"
		})
		expect(output.success).toBe(true)
		const text = await output.outputs[0].text()
		for (const value of forbidden) expect(text.includes(value), value).toBe(false)
	})

	test("browser entry bundles without Node-only dependencies", async () => {
		const output = await Bun.build({
			entrypoints: [new URL("../browser-mod.ts", import.meta.url).pathname],
			target: "browser",
			format: "esm"
		})
		expect(output.success).toBe(true)
		const text = await output.outputs[0].text()
		for (const value of forbidden) expect(text.includes(value), value).toBe(false)
	})
})
```

- [ ] **Step 2: Run browser boundary test and verify failure if browser entry still exports classic code**

Run from `packages/kkrpc`:

```bash
bun test __tests__/browser-boundary.test.ts
```

Expected: FAIL if browser entry still imports classic adapters or optional peers.

- [ ] **Step 3: Implement iframe transport**

Create `packages/kkrpc/src/transports/iframe.ts` with object-mode `postMessage` transport. Use a `MessagePort` when available and advertise `{ objectMode: true, transfer: true }` only for `MessagePort`-backed transports. Create `packages/kkrpc/iframe.ts`:

```ts
export * from "./src/transports/iframe.ts"
```

- [ ] **Step 4: Implement Chrome extension transport**

Create `packages/kkrpc/src/transports/chrome-extension.ts` with a `chromePortTransport(port)` factory that uses `port.postMessage(message)` and `port.onMessage.addListener(listener)`. Set capabilities to `{ objectMode: true, transfer: false }`.

Update `packages/kkrpc/chrome-extension.ts`:

```ts
export * from "./src/transports/chrome-extension.ts"
```

- [ ] **Step 5: Update browser entry**

Replace `packages/kkrpc/browser-mod.ts` with:

```ts
export * from "./src/core/index.ts"
export * from "./src/transports/worker.ts"
export * from "./src/transports/iframe.ts"
export * from "./src/transports/chrome-extension.ts"
export { webSocketClientTransport } from "./src/transports/ws.ts"
```

- [ ] **Step 6: Migrate browser examples**

Replace old imports in examples:

```ts
import { expose, RPCChannel, transfer, wrap } from "kkrpc/browser"
import { chromePortTransport } from "kkrpc/chrome-extension"
import { iframeChildTransport, iframeParentTransport } from "kkrpc/iframe"
```

Delete imports of `WorkerParentIO`, `WorkerChildIO`, `IframeParentIO`, `IframeChildIO`, and `ChromePortIO`.

- [ ] **Step 7: Run browser tests and examples typecheck**

Run:

```bash
bun test __tests__/browser-boundary.test.ts __tests__/worker.test.ts
pnpm check-types
pnpm --filter "./examples/*" check-types
```

Expected: PASS.

- [ ] **Step 8: Commit browser context slice**

```bash
git add packages/kkrpc examples/iframe-worker-demo examples/chrome-extension examples/transferable-browser
git commit -m "feat(kkrpc): add native browser context transports"
```

---

### Task 7: Electron And Tauri Native Transports

**Files:**

- Create: `packages/kkrpc/src/transports/electron.ts`
- Create: `packages/kkrpc/src/transports/tauri.ts`
- Modify: `packages/kkrpc/electron.ts`
- Create: `packages/kkrpc/tauri.ts`
- Delete: `packages/kkrpc/electron-ipc.ts`
- Rewrite examples: `examples/electron-demo/**`, `examples/tauri-demo/**`, `examples/deno-backend/**`
- Rewrite tests: Electron/Tauri-related tests and example regression tests.

- [ ] **Step 1: Write Electron export absence test**

Extend `packages/kkrpc/__tests__/package-exports.test.ts` to verify `./electron-ipc` is absent and `./electron` is present. This assertion already exists from Task 1; keep it green during this task.

- [ ] **Step 2: Implement Electron evented transport**

Create `packages/kkrpc/src/transports/electron.ts` with transports that accept structural IPC endpoints:

```ts
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export interface ElectronMessageEndpoint {
	send(channel: string, message: RPCMessage): void
	on(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void
	off(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void
}

export interface ElectronTransportOptions {
	endpoint: ElectronMessageEndpoint
	channel?: string
}

export function electronIpcTransport(options: ElectronTransportOptions): Transport<RPCMessage> {
	const channel = options.channel ?? "kkrpc:message"
	return {
		capabilities: { objectMode: true, transfer: false },
		send(message) {
			options.endpoint.send(channel, message)
		},
		subscribe(listener) {
			const wrapped = (_event: unknown, message: RPCMessage) => listener(message)
			options.endpoint.on(channel, wrapped)
			return () => options.endpoint.off(channel, wrapped)
		}
	}
}
```

Preserve utility-process support by adding structural factory overloads for `process.parentPort` and child process endpoints in the same file.

- [ ] **Step 3: Implement Tauri shell transport**

Create `packages/kkrpc/src/transports/tauri.ts` that wraps Tauri shell child stdout/stdin into `stdioJsonTransport`. Export `tauriShellStdioTransport(child)` and keep `@tauri-apps/plugin-shell` imports behind `kkrpc/tauri`.

Create `packages/kkrpc/tauri.ts`:

```ts
export * from "./src/transports/tauri.ts"
```

- [ ] **Step 4: Update Electron and Tauri examples**

Replace old imports:

```ts
import { expose, RPCChannel, wrap } from "kkrpc"
import { electronIpcTransport } from "kkrpc/electron"
import { tauriShellStdioTransport } from "kkrpc/tauri"
```

Remove `RPCChannel` imports from `kkrpc/electron-ipc`, `ElectronIpcMainIO`, `ElectronIpcRendererIO`, `ElectronUtilityProcessIO`, `ElectronUtilityProcessChildIO`, and `TauriShellStdio`.

- [ ] **Step 5: Run Electron and Tauri checks**

Run:

```bash
pnpm run check-types
```

from `examples/electron-demo`.

Run:

```bash
pnpm test
pnpm run check-types
pnpm run build
```

from `examples/tauri-demo`.

Expected: PASS. Existing Vite/Tauri bundle warnings may remain, but TypeScript/tests/build must exit 0.

- [ ] **Step 6: Commit Electron and Tauri slice**

```bash
git add packages/kkrpc examples/electron-demo examples/tauri-demo examples/deno-backend
git commit -m "feat(kkrpc): add native electron and tauri transports"
```

---

### Task 8: Native Message-Bus Transports

**Files:**

- Create: `packages/kkrpc/src/transports/bus-envelope.ts`
- Create: `packages/kkrpc/src/transports/rabbitmq.ts`
- Create: `packages/kkrpc/src/transports/kafka.ts`
- Create: `packages/kkrpc/src/transports/redis-streams.ts`
- Create: `packages/kkrpc/src/transports/nats.ts`
- Modify: `packages/kkrpc/rabbitmq.ts`
- Modify: `packages/kkrpc/kafka.ts`
- Modify: `packages/kkrpc/redis-streams.ts`
- Modify: `packages/kkrpc/nats.ts`
- Rewrite: `packages/kkrpc/__tests__/rabbitmq.test.ts`
- Rewrite: `packages/kkrpc/__tests__/kafka.test.ts`
- Rewrite: `packages/kkrpc/__tests__/redis-streams.test.ts`
- Rewrite: `packages/kkrpc/__tests__/nats.test.ts`

- [ ] **Step 1: Write bus envelope unit tests**

Create `packages/kkrpc/__tests__/bus-envelope.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import type { RPCMessage } from "../mod.ts"
import { createBusEnvelope, shouldDeliverBusEnvelope } from "../src/transports/bus-envelope.ts"

describe("bus envelope", () => {
	test("wraps RPC messages with routing metadata", () => {
		const message: RPCMessage = { t: "q", id: "request-1", op: "call", p: ["echo"], a: ["ok"] }
		const envelope = createBusEnvelope(message, {
			transportId: "bus",
			from: "client",
			to: "server"
		})

		expect(envelope.protocol).toBe("kkrpc.bus.v1")
		expect(envelope.transportId).toBe("bus")
		expect(envelope.from).toBe("client")
		expect(envelope.to).toBe("server")
		expect(envelope.correlationId).toBe("request-1")
		expect(envelope.message).toEqual(message)
	})

	test("filters self messages and messages addressed to other peers", () => {
		const message: RPCMessage = { t: "r", id: "request-1", v: "ok" }
		expect(
			shouldDeliverBusEnvelope(createBusEnvelope(message, { transportId: "bus", from: "client" }), {
				localPeerId: "client"
			})
		).toBe(false)
		expect(
			shouldDeliverBusEnvelope(
				createBusEnvelope(message, { transportId: "bus", from: "client", to: "server" }),
				{
					localPeerId: "other"
				}
			)
		).toBe(false)
		expect(
			shouldDeliverBusEnvelope(
				createBusEnvelope(message, { transportId: "bus", from: "client", to: "server" }),
				{
					localPeerId: "server"
				}
			)
		).toBe(true)
	})
})
```

- [ ] **Step 2: Run bus envelope tests and verify failure**

Run from `packages/kkrpc`:

```bash
bun test __tests__/bus-envelope.test.ts
```

Expected: FAIL because envelope helpers are not implemented.

- [ ] **Step 3: Implement bus envelope helpers**

Create `packages/kkrpc/src/transports/bus-envelope.ts`:

```ts
import type { RPCMessage } from "../core/protocol.ts"

export interface BusEnvelope {
	protocol: "kkrpc.bus.v1"
	transportId: string
	from: string
	to?: string
	correlationId?: string
	sequence?: number
	sentAt?: number
	message: RPCMessage
}

export interface CreateBusEnvelopeOptions {
	transportId: string
	from: string
	to?: string
	sequence?: number
}

export interface BusEnvelopeDeliveryOptions {
	localPeerId: string
	allowSelfMessages?: boolean
}

export function createBusEnvelope(
	message: RPCMessage,
	options: CreateBusEnvelopeOptions
): BusEnvelope {
	return {
		protocol: "kkrpc.bus.v1",
		transportId: options.transportId,
		from: options.from,
		to: options.to,
		correlationId: "id" in message ? message.id : undefined,
		sequence: options.sequence,
		sentAt: Date.now(),
		message
	}
}

export function shouldDeliverBusEnvelope(
	envelope: BusEnvelope,
	options: BusEnvelopeDeliveryOptions
): boolean {
	if (envelope.protocol !== "kkrpc.bus.v1") return false
	if (!options.allowSelfMessages && envelope.from === options.localPeerId) return false
	if (envelope.to && envelope.to !== options.localPeerId) return false
	return true
}
```

- [ ] **Step 4: Rewrite each message-bus transport as native `Transport<RPCMessage>`**

For each of `rabbitmq.ts`, `kafka.ts`, `redis-streams.ts`, and `nats.ts`:

- Export a factory ending with `Transport`, for example `rabbitMqTransport(options)` and `kafkaTransport(options)`.
- Accept `localPeerId`, optional `remotePeerId`, and existing connection options.
- Wrap outbound messages with `createBusEnvelope(message, { transportId, from: localPeerId, to: remotePeerId })`.
- Decode inbound envelopes and deliver only when `shouldDeliverBusEnvelope(envelope, { localPeerId })` returns true.
- Set capabilities to `{ objectMode: true, transfer: false, broadcast: remotePeerId === undefined }`.
- Implement `close()` to close or disconnect the underlying broker resources.

- [ ] **Step 5: Rewrite message-bus RPC tests**

In each integration test, replace classic `new KafkaIO(...)` and `new RPCChannel(adapter, ...)` with:

```ts
const serverTransport = kafkaTransport({
	brokers: KAFKA_BROKERS,
	topic,
	localPeerId: "server",
	remotePeerId: "client",
	retry: KAFKA_TEST_RETRY
})
const clientTransport = kafkaTransport({
	brokers: KAFKA_BROKERS,
	topic,
	localPeerId: "client",
	remotePeerId: "server",
	retry: KAFKA_TEST_RETRY
})
const serverRPC = new RPCChannel<API, API>(serverTransport, { expose: apiMethods })
const clientRPC = new RPCChannel<API, API>(clientTransport, { expose: apiMethods })
```

Use the equivalent native factory for RabbitMQ, Redis Streams, and NATS.

- [ ] **Step 6: Run message-bus focused tests**

Run from `packages/kkrpc`:

```bash
bun test __tests__/bus-envelope.test.ts __tests__/rabbitmq.test.ts __tests__/redis-streams.test.ts __tests__/nats.test.ts
KKRPC_RUN_KAFKA_TESTS=1 bun test __tests__/kafka.test.ts
pnpm check-types
```

Expected: PASS when local services are available. If a service is unavailable and the test is designed to skip without its env flag, record the skip condition in the final report.

- [ ] **Step 7: Commit message-bus slice**

```bash
git add packages/kkrpc
git commit -m "feat(kkrpc): add native message bus transports"
```

---

### Task 9: Relay, Inspector, Scripts, Docs, Skills, And Examples Cleanup

**Files:**

- Create: `packages/kkrpc/src/relay.ts` or `packages/kkrpc/src/features/relay.ts`
- Modify: `packages/kkrpc/relay.ts`
- Modify: `packages/kkrpc/inspector.ts`
- Modify: `packages/kkrpc/scripts/compare-browser-bundle-size.ts`
- Delete or modify: `packages/kkrpc/scripts/check-browser-lite-bundle.ts`
- Modify: `packages/kkrpc/package.json`
- Modify: `skills/kkrpc/SKILL.md`
- Rename/replace: `packages/kkrpc/NEXT_ARCHITECTURE.md` to `packages/kkrpc/ARCHITECTURE.md`
- Replace/delete: `packages/kkrpc/NEXT_MIGRATION.md`
- Modify: every `examples/**/README.md` and example source file still using old names.

- [ ] **Step 1: Rewrite relay as transport-to-transport helper**

Create a stable relay helper that does not import classic IO:

```ts
import type { RPCMessage } from "./core/protocol.ts"
import type { Transport } from "./core/transport.ts"

export interface RelayController {
	dispose(): void
}

export function relayTransport(
	left: Transport<RPCMessage>,
	right: Transport<RPCMessage>
): RelayController {
	const unsubscribeLeft = left.subscribe((message) => void right.send(message))
	const unsubscribeRight = right.subscribe((message) => void left.send(message))
	return {
		dispose() {
			unsubscribeLeft()
			unsubscribeRight()
		}
	}
}
```

Export it through `packages/kkrpc/relay.ts`.

- [ ] **Step 2: Update inspector to native events/plugins**

Remove imports of classic `RPCChannel` internals and old `IoInterface`. Expose inspector helpers that accept native channels, plugin hooks, or explicit event records. If existing inspector tests only check backend storage, keep those tests and update imports to `kkrpc/inspector` stable functions.

- [ ] **Step 3: Update browser bundle scripts**

Modify `packages/kkrpc/scripts/compare-browser-bundle-size.ts` so measured entries include:

```ts
;[
	"kkrpc",
	"kkrpc/browser",
	"kkrpc/worker",
	"kkrpc/validation",
	"kkrpc/middleware",
	"kkrpc/superjson"
]
```

Remove `kkrpc/next`, `kkrpc/browser-lite`, and `kkrpc/browser-mini` from that script.

Delete `packages/kkrpc/scripts/check-browser-lite-bundle.ts` and remove `check:browser-lite-bundle` from `packages/kkrpc/package.json`, or rename it to a stable browser bundle check that measures `kkrpc`.

- [ ] **Step 4: Update docs and skill**

Rename `packages/kkrpc/NEXT_ARCHITECTURE.md` to `packages/kkrpc/ARCHITECTURE.md` and replace imports in examples from `kkrpc/next` to `kkrpc`.

Replace `packages/kkrpc/NEXT_MIGRATION.md` with `packages/kkrpc/BREAKING_MIGRATION.md` containing:

```md
# Breaking Migration

The stable `kkrpc` entry now uses the native `Transport<RPCMessage>` architecture. Classic `IoInterface`, `IoMessage`, `RPCValidators`, `RPCInterceptor`, `classic-compat`, `next/io`, `browser-lite`, `browser-mini`, and `electron-ipc` public entries were removed in the next2main migration.
```

Update `skills/kkrpc/SKILL.md` to use stable imports such as:

```ts
import { expose, wrap } from "kkrpc"
import { validationPlugin } from "kkrpc/validation"
import { webSocketClientTransport } from "kkrpc/ws"
```

- [ ] **Step 5: Migrate remaining examples**

Run a search:

```bash
rg 'kkrpc/next|classic-compat|next/io|IoInterface|IoMessage|[A-Za-z0-9_]+IO\b|kkrpc/browser-lite|kkrpc/browser-mini|kkrpc/electron-ipc' examples skills packages/kkrpc --glob '!**/dist/**'
```

For each match outside `BREAKING_MIGRATION.md` and the superpowers design/plan docs, replace with native stable imports and transport factories.

- [ ] **Step 6: Run docs/scripts/example checks**

Run from repo root:

```bash
pnpm --filter kkrpc compare:browser-bundle-size
pnpm --filter "./examples/*" check-types
pnpm --filter "./examples/*" build
```

Expected: PASS. Existing Vite chunk-size warnings may remain.

- [ ] **Step 7: Commit docs, scripts, examples cleanup**

```bash
git add packages/kkrpc examples skills docs
git commit -m "docs(kkrpc): finish stable native migration cleanup"
```

---

### Task 10: Delete Classic Source And Run Final Gates

**Files:**

- Delete: remaining `packages/kkrpc/src/next/**`
- Delete: remaining `packages/kkrpc/src/adapters/**`
- Delete: remaining old entry wrappers: `packages/kkrpc/next*.ts`, `packages/kkrpc/browser-lite-mod.ts`, `packages/kkrpc/browser-mini-mod.ts`, `packages/kkrpc/electron-ipc.ts`
- Delete: old tests that still assert classic API behavior.
- Modify: `packages/kkrpc/package.json`
- Modify: `packages/kkrpc/tsdown.config.ts`

- [ ] **Step 1: Remove classic and temporary files**

Delete remaining old files with `apply_patch` delete sections or non-interactive `git rm` for files confirmed obsolete:

```text
packages/kkrpc/src/next/**
packages/kkrpc/src/adapters/**
packages/kkrpc/next*.ts
packages/kkrpc/browser-lite-mod.ts
packages/kkrpc/browser-mini-mod.ts
packages/kkrpc/electron-ipc.ts
```

Do not delete `dist/` because it is generated and ignored.

- [ ] **Step 2: Run old API grep gate**

Run from repo root:

```bash
rg 'kkrpc/next|next/io|classic-compat|IoInterface|IoMessage|RPCValidators|RPCInterceptor' packages examples skills docs \
	--glob '!docs/superpowers/specs/2026-06-09-next2main-native-migration-design.md' \
	--glob '!docs/superpowers/plans/**' \
	--glob '!packages/kkrpc/BREAKING_MIGRATION.md' \
	--glob '!**/dist/**'
```

Expected: no matches.

- [ ] **Step 3: Run old `*IO` grep gate**

Run from repo root:

```bash
rg 'export class [A-Za-z0-9_]+IO\b|class [A-Za-z0-9_]+IO\b|import \{[^}]*[A-Za-z0-9_]+IO\b' packages examples skills \
	--glob '!**/dist/**'
```

Expected: no matches.

- [ ] **Step 4: Run removed export grep gate**

Run from repo root:

```bash
rg '"\./next|"\./browser-lite"|"\./browser-mini"|"\./electron-ipc"' packages/kkrpc/package.json
```

Expected: no matches.

- [ ] **Step 5: Run full package verification**

Run from repo root:

```bash
pnpm --filter kkrpc check-types
pnpm --filter kkrpc build
pnpm --filter kkrpc test
pnpm --filter kkrpc test:deno
pnpm --filter kkrpc exec verify-package-export verify
```

Expected: all commands exit 0. `pnpm --filter kkrpc build` may show Typedoc warnings; record them in the final report.

- [ ] **Step 6: Run full examples verification**

Run from repo root:

```bash
pnpm --filter "./examples/*" check-types
pnpm --filter "./examples/*" build
```

Expected: all commands exit 0. Vite chunk-size or Browserslist warnings may remain; record them in the final report.

- [ ] **Step 7: Run focused example tests**

Run:

```bash
pnpm test
```

from `examples/http-demo`.

Run:

```bash
pnpm test
```

from `examples/tauri-demo`.

Expected: all focused example tests exit 0.

- [ ] **Step 8: Final commit**

```bash
git add packages/kkrpc examples skills docs
git commit -m "feat(kkrpc): complete native stable migration"
```

---

## Self-Review Notes

- Spec coverage: public export decisions, HTTP unary semantics, source layout, shared classic file fate, bus envelope routing, cleanup gates, browser boundary checks, examples/tests/docs, and final verification are all mapped to tasks.
- Placeholder scan: this plan intentionally avoids open-ended placeholders. Any line saying to implement a family also names exact files, public factories, test commands, and expected behavior.
- Type consistency: stable core imports use `RPCMessage`, `Transport`, `RPCChannel`, `wrap`, and `expose`; old `IoInterface`, `IoMessage`, and public `*IO` classes are treated as deletion targets.
