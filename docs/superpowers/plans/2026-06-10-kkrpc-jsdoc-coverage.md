# kkrpc JSDoc Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add useful source-level JSDoc to stable `kkrpc` core, feature, transport, and entry modules without changing runtime behavior.

**Architecture:** This is a documentation-only pass. Work is split by source area so each task can be reviewed independently: core APIs first, feature plugins second, transport families third, entrypoint modules fourth, then verification and PR update.

**Tech Stack:** TypeScript, JSDoc/TSDoc-style comments, Bun tests, tsdown, Typedoc, verify-package-export.

---

## File Structure

Modify existing files only:

- `packages/kkrpc/src/core/channel.ts`: Module docs, `RPCChannelOptions`, `RPCChannel`, lifecycle, message validation, callback envelope, transfer and timeout comments.
- `packages/kkrpc/src/core/index.ts`: Module docs and JSDoc for `wrap()`, `expose()`, `dispose()`, and `ExposedController`.
- `packages/kkrpc/src/core/protocol.ts`: Expand protocol record docs for request, response, callback, and operation fields.
- `packages/kkrpc/src/core/transport.ts`: Expand transport/platform/codec capability docs and `createTransport()` examples.
- `packages/kkrpc/src/core/plugins.ts`: Explain hook order, contexts, and plugin execution helpers.
- `packages/kkrpc/src/core/codecs.ts`: Add practical codec examples.
- `packages/kkrpc/src/core/transfer.ts`: Explain `transfer()` and descriptor consumption.
- `packages/kkrpc/src/core/utils.ts`: Keep short UUID helper docs.
- `packages/kkrpc/src/features/middleware.ts`: Explain receive-side onion middleware and example plugin usage.
- `packages/kkrpc/src/features/superjson.ts`: Explain SuperJSON codec use and aliases.
- `packages/kkrpc/src/features/validation.ts`: Expand Standard Schema, type-first, schema-first, error handling, and plugin docs.
- `packages/kkrpc/src/transports/*.ts`: Add module docs and factory docs for every transport file.
- `packages/kkrpc/src/entries/*.ts`: Add module docs explaining published subpaths, target runtimes, exclusions, and example imports.

Do not modify:

- `packages/kkrpc/dist/`
- `packages/kkrpc/docs/`
- package manifests
- runtime implementation logic, except formatting caused by comments

---

## Task 1: Core Module JSDoc

**Files:**

- Modify: `packages/kkrpc/src/core/channel.ts`
- Modify: `packages/kkrpc/src/core/index.ts`
- Modify: `packages/kkrpc/src/core/protocol.ts`
- Modify: `packages/kkrpc/src/core/transport.ts`
- Modify: `packages/kkrpc/src/core/plugins.ts`
- Modify: `packages/kkrpc/src/core/codecs.ts`
- Modify: `packages/kkrpc/src/core/transfer.ts`
- Modify: `packages/kkrpc/src/core/utils.ts`

- [ ] **Step 1: Add module-level docs to each core file**

Use this pattern at the top of `channel.ts` before imports:

````ts
/**
 * Core bidirectional RPC channel implementation.
 *
 * `RPCChannel` owns one `Transport<RPCMessage>`, exposes an optional local API,
 * and creates a proxy for the remote API. It handles request/response matching,
 * callback argument routing, transfer descriptors, timeouts, plugin hooks, and
 * lifecycle cleanup.
 *
 * ```ts
 * import { RPCChannel } from "kkrpc"
 *
 * const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { expose: localAPI })
 * const remote = channel.getAPI()
 * await remote.ping()
 * channel.destroy()
 * ```
 */
````

Add equivalent top-of-file comments for the other core files using their responsibilities from the File Structure section.

- [ ] **Step 2: Add JSDoc to public core exports**

Add docs for these exports:

```text
RPCChannelOptions
RPCChannel
ExposedController
wrap
expose
dispose
RPCError
RPCOperation
RPCRequest
RPCResponse
RPCCallback
RPCMessage
TransportCapabilities
PlatformCapabilities
CodecCapabilities
Transport
Platform
Codec
createTransport
RPCPlugin
RPCRequestContext
RPCHandlerContext
RPCResponseContext
RPCErrorContext
runRequestHooks
runHandlerHooks
runResponseHooks
runErrorHooks
objectCodec
jsonCodec
jsonLineCodec
TransferDescriptor
transfer
takeTransferDescriptor
hasTransferDescriptor
generateUUID
```

For `wrap()`, use this example:

````ts
/**
 * Create a typed proxy for a remote API exposed on the other side of a transport.
 *
 * Use this for the common client-only case. The returned proxy is registered for
 * disposal, so `dispose(proxy)` tears down the underlying channel.
 *
 * ```ts
 * import { wrap } from "kkrpc"
 * import { webSocketClientTransport } from "kkrpc/ws"
 *
 * const api = wrap<RemoteAPI>(webSocketClientTransport({ url: "ws://localhost:3000" }))
 * console.log(await api.ping())
 * ```
 */
````

For `createTransport()`, include an example using `jsonLineCodec()` and `stdioPlatform()` conceptually:

```ts
/**
 * Compose a wire-level platform and codec into a message-level transport.
 *
 * Transfer support is enabled only when both the platform and codec explicitly
 * advertise `transfer: true`.
 */
```

- [ ] **Step 3: Add concise comments for key internals in `channel.ts`**

Add comments above these internal areas:

```text
ARG_ENVELOPE_TAG / ArgEnvelope types: callbacks and values are wrapped so user data cannot be confused with callback markers.
isRPCRequestMessage / isRPCResponseMessage / isRPCCallbackMessage: transports may share non-kkrpc frames; malformed frames are ignored.
request(): registers pending response before sending to avoid races.
post(): rejects the pending request when transport writes fail.
encodeArgs/decodeArgs: callback functions become callback records routed by id.
encodeValue(): consumes transfer descriptors only when the transport supports transfer.
```

- [ ] **Step 4: Run focused checks**

Run: `bun test packages/kkrpc/__tests__/core.test.ts`

Expected: all tests in the file pass.

Run: `pnpm --filter kkrpc check-types`

Expected: exit 0.

- [ ] **Step 5: Commit core JSDoc**

```bash
git add packages/kkrpc/src/core
git commit -m "docs(kkrpc): document core rpc primitives"
```

---

## Task 2: Feature Plugin JSDoc

**Files:**

- Modify: `packages/kkrpc/src/features/middleware.ts`
- Modify: `packages/kkrpc/src/features/superjson.ts`
- Modify: `packages/kkrpc/src/features/validation.ts`

- [ ] **Step 1: Add module-level docs to each feature file**

Use this pattern for `middleware.ts`:

````ts
/**
 * Receive-side middleware plugin for stable RPC channels.
 *
 * Middleware wraps local handler execution using an onion model. It is useful for
 * logging, authorization, metrics, argument inspection, or result transformation.
 *
 * ```ts
 * import { expose } from "kkrpc"
 * import { middlewarePlugin } from "kkrpc/middleware"
 *
 * expose(api, transport, { plugins: [middlewarePlugin([logger])] })
 * ```
 */
````

Use equivalent module docs for `superjson.ts` and `validation.ts`.

- [ ] **Step 2: Add JSDoc to middleware exports**

Document:

```text
RPCCallContext
MiddlewareHandler
runInterceptors
middlewarePlugin
```

The `middlewarePlugin()` comment must mention that it wraps receive-side handler invocation and does not run for outgoing calls.

- [ ] **Step 3: Add JSDoc to SuperJSON exports**

Document:

```text
superJsonCodec
superJsonLineCodec
superjsonCodec
superjsonLineCodec
```

Include a usage example:

```ts
import { superJsonCodec } from "kkrpc/superjson"
import { createTransport } from "kkrpc/transport"

const transport = createTransport({ platform, codec: superJsonCodec() })
```

- [ ] **Step 4: Add JSDoc to validation exports**

Document:

```text
StandardSchemaV1
MethodValidators
ValidatorMap
RPCValidationError
isRPCValidationError
lookupValidator
runValidation
MethodSchemaConfig
DefinedMethod
defineMethod
defineAPI
extractValidators
InferAPI
validationPlugin overloads
```

Include both type-first and schema-first examples in comments near `ValidatorMap`, `defineMethod()`, and `validationPlugin()`.

- [ ] **Step 5: Run focused checks**

Run: `bun test packages/kkrpc/__tests__/validation.test.ts packages/kkrpc/__tests__/middleware.test.ts packages/kkrpc/__tests__/superjson.test.ts`

Expected: selected tests pass.

Run: `pnpm --filter kkrpc check-types`

Expected: exit 0.

- [ ] **Step 6: Commit feature JSDoc**

```bash
git add packages/kkrpc/src/features
git commit -m "docs(kkrpc): document feature plugins"
```

---

## Task 3: Transport JSDoc

**Files:**

- Modify: `packages/kkrpc/src/transports/bus-envelope.ts`
- Modify: `packages/kkrpc/src/transports/chrome-extension.ts`
- Modify: `packages/kkrpc/src/transports/electron.ts`
- Modify: `packages/kkrpc/src/transports/http.ts`
- Modify: `packages/kkrpc/src/transports/iframe.ts`
- Modify: `packages/kkrpc/src/transports/kafka.ts`
- Modify: `packages/kkrpc/src/transports/nats.ts`
- Modify: `packages/kkrpc/src/transports/rabbitmq.ts`
- Modify: `packages/kkrpc/src/transports/redis-streams.ts`
- Modify: `packages/kkrpc/src/transports/socketio.ts`
- Modify: `packages/kkrpc/src/transports/stdio.ts`
- Modify: `packages/kkrpc/src/transports/tauri.ts`
- Modify: `packages/kkrpc/src/transports/web-socket-client.ts`
- Modify: `packages/kkrpc/src/transports/worker.ts`
- Modify: `packages/kkrpc/src/transports/ws-elysia.ts`
- Modify: `packages/kkrpc/src/transports/ws-hono.ts`
- Modify: `packages/kkrpc/src/transports/ws.ts`

- [ ] **Step 1: Add module-level docs for transport families**

Each transport file must start with a module comment explaining the runtime. Example for `http.ts`:

````ts
/**
 * Unary HTTP transport and handler for stable kkrpc.
 *
 * HTTP maps each RPC request to one POST request and one JSON response. It is
 * useful for simple web APIs, but it cannot support callback arguments or
 * server-initiated calls because the server has no persistent channel back to
 * the client.
 *
 * ```ts
 * import { wrap } from "kkrpc"
 * import { httpClientTransport } from "kkrpc/http"
 *
 * const api = wrap<RemoteAPI>(httpClientTransport({ url: "http://localhost:3000/rpc" }))
 * ```
 */
````

- [ ] **Step 2: Add JSDoc for exported transport options and factories**

Document every export found by:

```bash
rg '^export (class|function|interface|type|const)' packages/kkrpc/src/transports
```

Each factory comment must answer:

```text
What runtime primitive does it wrap?
Is it bidirectional or unary?
Does it support callbacks?
Does it support transferables?
What cleanup/lifecycle behavior should the caller expect?
```

- [ ] **Step 3: Add key internal comments for transport-specific mechanics**

Add concise comments for:

```text
bus-envelope.ts: session/source/target filtering and why envelopes prevent cross-talk.
iframe.ts: MessageChannel handshake, ready transport variants, and parent/child roles.
http.ts: request structural validation and callback-envelope rejection.
ws.ts: open-state send queueing and close/error handling.
ws-hono.ts and ws-elysia.ts: feedable transport behavior for framework message callbacks.
kafka.ts, rabbitmq.ts, redis-streams.ts, nats.ts: envelope parsing and self-delivery filtering.
electron.ts: endpoint-like interfaces avoid direct Electron imports.
tauri.ts: shell stdout/process endpoint shape.
```

- [ ] **Step 4: Run transport-focused tests**

Run:

```bash
bun test packages/kkrpc/__tests__/http.test.ts packages/kkrpc/__tests__/websocket.test.ts packages/kkrpc/__tests__/worker.test.ts packages/kkrpc/__tests__/relay.test.ts packages/kkrpc/__tests__/bus-envelope.test.ts
```

Expected: selected tests pass.

Run:

```bash
bun test packages/kkrpc/__tests__/rabbitmq.test.ts packages/kkrpc/__tests__/redis-streams.test.ts packages/kkrpc/__tests__/kafka.test.ts packages/kkrpc/__tests__/nats.test.ts
```

Expected: selected tests pass or skip according to available broker services; do not change tests to force pass.

Run: `pnpm --filter kkrpc check-types`

Expected: exit 0.

- [ ] **Step 5: Commit transport JSDoc**

```bash
git add packages/kkrpc/src/transports
git commit -m "docs(kkrpc): document native transports"
```

---

## Task 4: Entry Point JSDoc

**Files:**

- Modify all files in `packages/kkrpc/src/entries/`

- [ ] **Step 1: Add module-level JSDoc to simple re-export entries**

For one-line re-export files, add a comment before the export. Example for `ws.ts`:

````ts
/**
 * Published `kkrpc/ws` entry for WebSocket transports.
 *
 * Import this entry in Node.js, Bun, Deno, or browser clients that need a
 * WebSocket-backed `Transport<RPCMessage>`. Server runtimes can wrap accepted
 * socket objects with `webSocketTransport()`, while clients can use
 * `webSocketClientTransport()`.
 *
 * ```ts
 * import { wrap } from "kkrpc"
 * import { webSocketClientTransport } from "kkrpc/ws"
 * ```
 */
export * from "../transports/ws.ts"
````

Apply equivalent comments to:

```text
chrome-extension.ts
codecs.ts
electron.ts
http.ts
iframe.ts
kafka.ts
middleware.ts
nats.ts
plugins.ts
rabbitmq.ts
redis-streams.ts
relay.ts
socketio.ts
stdio.ts
superjson.ts
tauri.ts
transport.ts
validation.ts
worker.ts
ws-elysia.ts
ws-hono.ts
```

- [ ] **Step 2: Add module-level docs to multi-export entries**

Document:

```text
mod.ts: stable browser-safe core package entry; excludes runtime transports and optional peers.
browser-mod.ts: explicit browser-safe entry; includes browser context transports and browser WebSocket client helper; excludes stdio and message buses.
deno-mod.ts: Deno-friendly entry; includes core, worker, and generic stdio primitives but excludes Node-bound process default stdio helper.
inspector.ts: observability helpers and in-memory/console backends.
```

Include compact examples in each file.

- [ ] **Step 3: Run entry/export checks**

Run: `bun test packages/kkrpc/__tests__/package-exports.test.ts packages/kkrpc/__tests__/browser-boundary.test.ts`

Expected: selected tests pass.

Run: `pnpm --filter kkrpc exec verify-package-export verify`

Expected: exit 0.

Run: `pnpm --filter kkrpc check-types`

Expected: exit 0.

- [ ] **Step 4: Commit entry JSDoc**

```bash
git add packages/kkrpc/src/entries
git commit -m "docs(kkrpc): document public entrypoints"
```

---

## Task 5: Final Verification And PR Update

**Files:**

- Review all modified source files in targeted directories.
- Do not modify generated output.

- [ ] **Step 1: Scan for missing module JSDoc**

Run:

```bash
node - <<'JS'
const fs = require('node:fs')
const path = require('node:path')
const dirs = [
  'packages/kkrpc/src/core',
  'packages/kkrpc/src/features',
  'packages/kkrpc/src/transports',
  'packages/kkrpc/src/entries'
]
let missing = []
for (const dir of dirs) {
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue
    const full = path.join(dir, file)
    const text = fs.readFileSync(full, 'utf8').trimStart()
    if (!text.startsWith('/**')) missing.push(full)
  }
}
if (missing.length) {
  console.error(missing.join('\n'))
  process.exit(1)
}
console.log('all targeted modules have module JSDoc')
JS
```

Expected: `all targeted modules have module JSDoc`.

- [ ] **Step 2: Scan for removed API names in source examples**

Run:

```bash
rg 'NodeIo|WebSocketClientIO|HTTPClientIO|createHttpClient|electron-ipc|browser-lite|browser-mini|kkrpc/next|next/io' packages/kkrpc/src/core packages/kkrpc/src/features packages/kkrpc/src/transports packages/kkrpc/src/entries
```

Expected: no matches.

- [ ] **Step 3: Run full package verification**

Run: `pnpm --filter kkrpc check-types`

Expected: exit 0.

Run: `pnpm --filter kkrpc build`

Expected: exit 0. Existing Typedoc warnings may remain; no TypeScript errors.

Run: `pnpm --filter kkrpc test`

Expected: test suite passes.

- [ ] **Step 4: Inspect diff before final commit**

Run:

```bash
git status --short
git diff --stat
git diff -- packages/kkrpc/src/core packages/kkrpc/src/features packages/kkrpc/src/transports packages/kkrpc/src/entries
```

Expected: only documentation/comment changes in targeted source files.

- [ ] **Step 5: Commit final verification if needed**

If any task left uncommitted changes, commit them:

```bash
git add packages/kkrpc/src/core packages/kkrpc/src/features packages/kkrpc/src/transports packages/kkrpc/src/entries
git commit -m "docs(kkrpc): complete source jsdoc coverage"
```

If there are no uncommitted changes, skip this step.

- [ ] **Step 6: Push PR branch**

Run:

```bash
git push
```

Expected: `next2main` updates on `origin`.

---

## Self-Review Notes

- Spec coverage: Tasks cover all directories and all success criteria from `docs/superpowers/specs/2026-06-10-kkrpc-jsdoc-coverage-design.md`.
- Placeholder scan: No incomplete placeholders are intentionally left in this plan.
- Type consistency: Commands and file paths match the current package layout after the `src/entries` move.
