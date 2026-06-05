# Browser Lite Serialization Design

Date: 2026-06-05

## Context

Issue #24 requests a minimal browser bundle that does not include SuperJSON. The current browser entrypoint imports `src/channel.ts`, which imports `src/serialization.ts`, which statically imports `superjson`. As a result, browser bundlers can include SuperJSON even when users only need JSON or structured-clone messaging.

The current package already supports `serialization: { version: "json" }`, but the dependency graph still reaches SuperJSON at import time. The improved design should remove that coupling without changing the public `new RPCChannel(...)` API.

The feature branch is `feat/browser-lite`, based on `origin/main`, with the existing metadata propagation commit reapplied on top.

## Goals

- Add a browser-focused entrypoint that avoids any static SuperJSON import.
- Keep the existing `RPCChannel` facade and constructor shape unchanged.
- Avoid duplicating the full channel state machine.
- Preserve existing `kkrpc`, `kkrpc/browser`, and SuperJSON behavior.
- Keep Worker/iframe structured envelope and transfer support available in the lite entrypoint.
- Verify the browser-lite output through the existing `tsdown` build pipeline.

## Non-Goals

- Do not replace the public `RPCChannel` constructor with a user-facing factory function.
- Do not copy `channel.ts` into a large `channel-minimal.ts` fork.
- Do not introduce esbuild or another bundler solely for bundle assertions.
- Do not split validation, middleware, or transfer helpers unless later measurement shows they are material bundle-size contributors.

## Recommended Architecture

Keep one shared channel implementation and move the serialization choice behind thin entrypoint-specific wrappers.

Proposed source layout:

```txt
packages/kkrpc/
  browser-lite-mod.ts
  src/
    channel-core.ts
    channel.ts
    channel-lite.ts
    serialization.ts
    serialization-types.ts
    serialization-json.ts
    serialization-full.ts
```

Responsibilities:

| File | Responsibility |
|---|---|
| `channel-core.ts` | Shared `RPCChannelCore` state machine. It does not import SuperJSON. |
| `channel.ts` | Existing full `RPCChannel` wrapper. It imports the full serializer. |
| `channel-lite.ts` | Lite `RPCChannel` wrapper. It imports only the JSON serializer. |
| `serialization.ts` | Compatibility barrel for the existing full serialization API. It may re-export from `serialization-full.ts` and `serialization-types.ts`. Browser-lite must not import it. |
| `serialization-types.ts` | Shared protocol types such as `Message`, `Response`, `WireEnvelope`, metadata, and transfer slots. |
| `serialization-json.ts` | JSON string serialization, structured envelope encode/decode, transfer processing, and error serialization. No SuperJSON import. |
| `serialization-full.ts` | Full serializer with SuperJSON support and existing compatibility behavior. |

The main dependency invariant is:

```txt
browser-lite-mod.ts -> channel-lite.ts -> channel-core.ts -> serialization-json.ts
```

This path must not import `serialization-full.ts`, `serialization.ts`, or `superjson`.

Shared runtime files used by both entries should import protocol types from `serialization-types.ts`, not from the compatibility `serialization.ts` barrel.

The existing full path remains:

```txt
browser-mod.ts -> channel.ts -> channel-core.ts -> serialization-full.ts -> superjson
```

## Serializer Runtime Contract

`channel-core.ts` receives a serializer runtime from the wrapper class. The interface is internal and should stay small:

```ts
interface RPCSerializationRuntime {
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

`channel.ts` exports the existing class name:

```ts
export class RPCChannel<LocalAPI, RemoteAPI, Io> extends RPCChannelCore<LocalAPI, RemoteAPI, Io> {
	constructor(io: Io, options?: RPCChannelOptions<LocalAPI>) {
		super(io, options, fullSerializationRuntime)
	}
}
```

`channel-lite.ts` exports the same public class name:

```ts
export class RPCChannel<LocalAPI, RemoteAPI, Io> extends RPCChannelCore<LocalAPI, RemoteAPI, Io> {
	constructor(io: Io, options?: RPCChannelOptions<LocalAPI>) {
		super(io, options, jsonSerializationRuntime)
	}
}
```

If needed, shared constructor option types can move from `channel.ts` into `channel-core.ts` or a small `channel-types.ts` file.

## Public API

Add a new subpath export:

```ts
import { RPCChannel, WorkerParentIO } from "kkrpc/browser-lite"
```

Existing imports stay valid:

```ts
import { RPCChannel } from "kkrpc/browser"
import { RPCChannel } from "kkrpc"
```

Runtime defaults:

| Entry | Default serialization | SuperJSON dependency |
|---|---|---|
| `kkrpc` | `superjson` | Yes |
| `kkrpc/browser` | `superjson` | Yes |
| `kkrpc/browser-lite` | `json` | No |

## Compatibility Behavior

| Case | Behavior |
|---|---|
| Lite to Lite over Worker/iframe | Works. Uses structured envelope when transfers are enabled. |
| Lite to Lite over string transport | Works with JSON serialization. |
| Full to Full | Existing behavior unchanged. |
| Full JSON to Lite JSON | Works if both sides use JSON serialization. |
| Full default SuperJSON to Lite over string transport | Not supported. Lite should reject with a clear error. |
| Lite with `serialization.version = "superjson"` | Throw a clear runtime error. |

The lite decoder must not import SuperJSON to parse legacy SuperJSON strings. If it receives a SuperJSON-looking wire string, it should throw an actionable error:

```txt
Received a SuperJSON-encoded kkrpc message, but this entrypoint is JSON-only. Use kkrpc/browser or configure both endpoints with serialization.version = "json".
```

Structured envelope messages remain object payloads and do not require SuperJSON.

## Export And Build Changes

Add `browser-lite-mod.ts` with browser-safe exports:

```ts
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

Update:

- `packages/kkrpc/tsdown.config.ts`: add `./browser-lite-mod.ts` to entries.
- `packages/kkrpc/package.json`: add `./browser-lite` export for ESM, CJS, and types.
- `packages/kkrpc/deno.json`: add `./browser-lite` export.
- README or docs: document when to use `browser-lite` versus `browser`.

The existing `tsdown` build is the canonical bundle verification path. Do not add esbuild.

## Tests And Verification

Unit and integration tests:

| Test | Purpose |
|---|---|
| JSON serializer round-trip | `serialization-json.ts` serializes and deserializes messages without SuperJSON. |
| Lite rejects SuperJSON | Lite decoder rejects SuperJSON-looking wire strings with a clear error. |
| Lite RPC integration | `channel-lite.ts` can call a simple API through a test `IoInterface`. |
| Structured envelope regression | Existing transfer/envelope path still reconstructs transferred values. |
| Full serializer regression | Existing SuperJSON behavior remains unchanged. |

Build verification:

```bash
pnpm --filter kkrpc build
rg "superjson|copy-anything|is-what" packages/kkrpc/dist/browser-lite-mod.*
```

The search should return no matches for the lite bundle. This can be formalized as a package script using Bun and the generated `dist/` files if recurring release checks need it.

## Implementation Order

1. Extract protocol and wire types into `serialization-types.ts`.
2. Extract JSON/string/envelope/error/transfer logic into `serialization-json.ts`.
3. Create `serialization-full.ts` that wraps or extends JSON behavior with SuperJSON support.
4. Keep `serialization.ts` as a compatibility full-serialization barrel for existing imports.
5. Move the channel implementation into `channel-core.ts` and replace direct serialization imports with the runtime contract.
6. Recreate `channel.ts` as the full wrapper and add `channel-lite.ts` as the JSON-only wrapper.
7. Add `browser-lite-mod.ts` and package/JSR/tsdown exports.
8. Add tests and run typecheck/build/test verification.
9. Update docs for `browser-lite` usage and limitations.

## Risks

- The channel extraction is a broad move, so preserve behavior with small commits and focused tests.
- Full and lite wrappers must export the same public class name to avoid facade API churn.
- Type exports must remain source-compatible for existing users importing protocol types from `serialization.ts`.
- Lite/full interop over string transports requires explicit JSON configuration on the full side.

## Success Criteria

- Existing `kkrpc` and `kkrpc/browser` behavior remains compatible.
- `kkrpc/browser-lite` builds and exposes `RPCChannel` with the same constructor facade.
- `browser-lite` dependency path does not statically import SuperJSON.
- `tsdown` output for `browser-lite-mod` contains no SuperJSON dependency strings.
- Existing tests pass, and new lite serialization/RPC tests cover the new path.
