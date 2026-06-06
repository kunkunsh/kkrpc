# Browser Mini Bundle Optimization Design

## Goal

Add a new browser-only compact entry point, `kkrpc/browser-mini`, that gets much closer to
`comctx` bundle size while keeping the existing `kkrpc/browser` and `kkrpc/browser-lite` entries
unchanged.

The mini entry is an explicit feature subset. It should preserve the ergonomic proxy API for common
browser RPC use cases, but it should not import the full `RPCChannelCore`, validation, middleware,
SuperJSON, streaming, or full browser adapters.

## Current Context

The existing `kkrpc/browser-lite` entry avoids SuperJSON, but it still imports the shared
`src/channel-core.ts` implementation. That core carries the complete runtime state machine:
request/response, callbacks, property get/set, constructors, timeouts, validation, interceptors,
structured transfer slots, newline string framing, async iterable streaming, broadcast behavior, and
close cleanup.

The bundle benchmark already measures `kkrpc/browser`, `kkrpc/browser-lite`, a direct lite import,
and `comctx`. Current measurements show `channel-core.ts` is the largest `browser-lite` contributor,
so the next meaningful size reduction needs a separate compact channel rather than another wrapper
around the same core.

## Entry Point

Add a new public export:

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
}
```

Add `./browser-mini-mod.ts` to `tsdown.config.ts` entries.

The entry exports:

```ts
export { RPCChannel, type RPCChannelOptions } from "./src/browser-mini/channel.ts"
export { WorkerParentIO, WorkerChildIO } from "./src/browser-mini/worker.ts"
export { transfer, type TransferDescriptor } from "./src/transfer.ts"
```

The first implementation exports worker transports only. Iframe transports are deferred to a separate
follow-up after the worker-only size is measured.

## Public API

The mini channel keeps the familiar shape:

```ts
const rpc = new RPCChannel<LocalAPI, RemoteAPI>(new WorkerParentIO(worker), {
	expose: localApi,
	timeout: 1000,
	enableTransfer: true
})

const api = rpc.getAPI()
await api.math.add(1, 2)
const value = await api.config.name
api.config.name = "demo"
const instance = await new api.Widget("name")
```

Options:

```ts
export interface RPCChannelOptions<LocalAPI extends Record<string, unknown>> {
	expose?: LocalAPI
	timeout?: number
	enableTransfer?: boolean
}
```

Methods:

```ts
expose(api: LocalAPI): void
getAPI(): RemoteAPI
destroy(): void
```

The setter trap preserves current ergonomic behavior: assignment returns `true` from the proxy trap,
while the underlying set request runs asynchronously. The mini entry does not add a separate public
setter API in the first implementation.

## Transport API

The mini implementation should use a small event-based transport instead of the full `IoInterface`
read loop:

```ts
export interface MiniTransport {
	post(message: MiniMessage, transfers?: Transferable[]): void | Promise<void>
	onMessage(listener: (message: MiniMessage) => void): () => void
	destroy?(): void
	canTransfer?: boolean
}
```

`WorkerParentIO` wraps a `Worker`. `WorkerChildIO` wraps `globalThis`/`self`. Both send structured
clone objects directly and pass transfer lists to `postMessage` when enabled.

This entry intentionally does not support string-only transports. That excludes WebSocket and newline
framing from the compact channel, which avoids JSON serialization code and keeps the protocol small.

## Protocol

Use terse structured-clone messages. Field names are intentionally short because they appear in the
minified bundle and every message payload.

```ts
type MiniMessage =
	| { t: "q"; id: string; op: "call" | "get" | "set" | "new"; p: string[]; a?: unknown[]; v?: unknown }
	| { t: "r"; id: string; v?: unknown; e?: MiniError }
	| { t: "cb"; id: string; a: unknown[] }

interface MiniError {
	n: string
	m: string
	s?: string
}
```

The channel keeps one pending map keyed by `id`. Requests use `q`, responses use `r`, and callback
invocations use `cb`.

## Proxy Behavior

The proxy stores a path array rather than dot-joining method names. This removes split/join work and
keeps nested paths precise.

Supported traps:

```ts
get: builds nested proxies; `then` on a non-empty path performs remote get
set: sends remote set and returns true
apply: sends remote call
construct: sends remote constructor call
```

The proxy should return native function properties such as `apply`, `call`, `bind`, `length`, and
`name` from the target function when needed, matching the small-proxy pattern used by `comctx`.

Only string property keys are sent over the wire. Symbol keys are ignored except for built-in proxy
or runtime inspection paths.

## Local Dispatch

For incoming `q` messages:

`call` resolves the parent object and function name from the path, restores callback placeholders,
then invokes the function with `this` bound to the parent object.

`get` resolves the path and returns the property value.

`set` resolves the parent path, assigns the last key to `v`, and returns `true`.

`new` resolves the constructor function and calls `new Ctor(...args)`.

Errors are caught and sent as compact `MiniError` objects. The receiver reconstructs them as `Error`
instances and preserves `name`, `message`, and `stack` when available.

## Callbacks

The mini entry supports function arguments passed directly in RPC call or constructor arguments. Each
function is replaced with a small callback placeholder before sending. When the remote side invokes
that placeholder, the channel sends a `cb` message with the callback id and arguments.

Callbacks are fire-and-forget, matching current `kkrpc` callback behavior. Callback return values are
not awaited or returned to the invoker.

Nested function values inside arbitrary objects are out of scope for the first mini implementation.
Only direct argument positions are supported.

## Transfers

The mini entry reuses the existing `transfer(value, transfers)` marker and `takeTransferDescriptor()`
helper from `src/transfer.ts`. Before sending request arguments, set values, constructor arguments,
callback arguments, or response values, the mini channel checks for transfer descriptors at top-level
values and includes their transfer lists in the transport send.

The mini entry does not import `serialization-json.ts`, `transfer-handlers.ts`, or transfer slot
reconstruction. This means it supports browser structured-clone transfers for marked values, not the
full kkrpc transfer-slot envelope for nested arbitrary positions or custom transfer handlers.

## Timeouts And Cleanup

`timeout` applies to outgoing `q` requests. A timed-out request rejects with a normal `Error` whose
name is `RPCTimeoutError` and whose message includes the path and timeout. The mini entry does not
export the full timeout error class in the first implementation.

`destroy()` unsubscribes the transport listener, rejects pending requests with `RPC channel destroyed`,
clears callbacks, and calls `transport.destroy?.()`.

## Explicitly Omitted Features

The mini entry does not support:

- validation or Standard Schema helpers
- middleware/interceptors
- SuperJSON
- string-only transports or newline framing
- WebSocket adapters
- async iterable streaming protocol
- custom metadata propagation
- broadcast transports
- rich transfer handlers or nested transfer-slot envelopes
- non-browser runtime adapters

Users who need these features should continue importing `kkrpc/browser` or `kkrpc/browser-lite`.

## Benchmarking

Extend `packages/kkrpc/scripts/compare-browser-bundle-size.ts` with a new `kkrpc/browser-mini` case.
The sample should mirror the existing public browser sample but import from `kkrpc/browser-mini`.

The benchmark output should continue to report raw minified, gzip, brotli, module count, and top
contributors for all entries. `comctx` remains the external comparison target.

No hard size threshold is required for the first implementation because the benchmark should report
actual output. The implementation is successful only if `browser-mini` is materially smaller than the
current `browser-lite` measurement and the contributor table shows it does not import
`src/channel-core.ts`.

## Tests

Add focused Bun tests for the mini channel:

- remote method call over worker mini transport
- nested method path
- callback argument invocation
- remote getter via `await api.prop`
- remote setter via assignment plus observed local state
- remote constructor via `new api.Ctor()`
- transfer of a marked `ArrayBuffer`
- timeout rejection
- destroy rejection for pending calls

Add benchmark script tests that assert the new benchmark case exists and formats correctly.

Run focused verification from `packages/kkrpc`:

```bash
bun test __tests__/browser-mini.test.ts
bun test __tests__/browser-bundle-benchmark-script.test.ts
pnpm --filter kkrpc check-types
pnpm --filter kkrpc compare:browser-bundle-size
```

Avoid `pnpm --filter kkrpc test -- __tests__/...` for focused runs because the package test script
does not honor that file argument and may run unrelated integration tests.

## Acceptance Criteria

- `kkrpc/browser-mini` is exported from `package.json` and built by `tsdown`.
- `kkrpc/browser-mini` does not import `src/channel-core.ts`, validation, middleware, SuperJSON, or
  full browser adapters.
- The mini channel supports call, nested call, callback arguments, get, set, construct, basic timeout,
  destroy cleanup, and marked top-level transfers.
- Existing `kkrpc/browser` and `kkrpc/browser-lite` behavior is unchanged.
- The browser bundle benchmark includes `kkrpc/browser-mini` and compares it with `comctx`.
- Focused tests, typecheck, and the browser bundle benchmark pass.
