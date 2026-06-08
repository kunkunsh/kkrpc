# kkrpc Next Feature Plugins Design

## Goal

Make `kkrpc/next` capable of the same feature classes as the current full runtime while keeping the
default core small. Heavy behavior should be opt-in through separate entrypoints that tree-shake away
when unused.

The first implementation slice should add the extension surface and prove it with validation,
middleware, and SuperJSON. Later slices can add metadata, streaming, rich transfer handlers, and
broadcast without changing the core API again.

## Non-Goals

This design does not make `kkrpc/next` import validation, middleware, or SuperJSON from the core entry.
It also does not require exact compatibility with every old option name inside `kkrpc/next` itself.
Compatibility is provided by optional facade modules so the core does not regain the current
`channel-core.ts` coupling.

This design does not implement all classic heavy features in the first slice. It defines where they fit
so the first slice does not block future parity.

## Current Context

The current `kkrpc/next` preview already has:

- small `RPCChannel`, `wrap`, `expose`, and `dispose`
- compact request/response/callback protocol
- `Transport`, `Platform`, `Codec`, and `createTransport`
- `objectCodec`, `jsonCodec`, and `jsonLineCodec`
- worker object transport and stdio JSON transport
- package exports and bundle benchmark rows

The current classic feature code has reusable pieces:

- `validation.ts`: Standard Schema support, `RPCValidationError`, `defineMethod`, `defineAPI`,
  `extractValidators`, `lookupValidator`, and `runValidation`
- `middleware.ts`: onion-model interceptors through `runInterceptors`
- `serialization-full.ts`: SuperJSON import and stringify/parse behavior
- `serialization-json.ts`: richer error preservation and transfer-slot patterns that can inform later
  codecs or plugins

## Design Principles

- Core stays feature-agnostic. `kkrpc/next` may know that plugins exist, but it must not know about
  validation, middleware, SuperJSON, Zod, tracing, or streaming.
- Feature modules depend on core, never the other way around.
- Codecs own wire value representation. SuperJSON belongs in `kkrpc/next/superjson`, not as a core
  plugin.
- Plugins own RPC lifecycle behavior. Validation, middleware, tracing, and metadata belong in plugins.
- Compatibility facades are optional entrypoints. They may accept old-style option names and translate
  them into codecs/plugins, but they must not be imported by `kkrpc/next`.
- Unknown capabilities default to safe behavior. Transfer forwarding stays explicit opt-in.

## Entry Point Shape

First slice entries:

```ts
kkrpc/next                  // small core: RPCChannel, wrap, expose, dispose, protocol, plugin types
kkrpc/next/plugins          // plugin helpers and type exports, no feature implementations
kkrpc/next/validation       // Standard Schema validation plugin and schema-first helpers
kkrpc/next/middleware       // interceptor plugin and interceptor types
kkrpc/next/superjson        // SuperJSON codec
kkrpc/next/classic-compat   // optional facade for migration
```

Existing entries remain:

```ts
kkrpc/next/worker
kkrpc/next/stdio
kkrpc/next/transport
kkrpc/next/codecs
```

`kkrpc/next` can re-export plugin types because they are type/light helper definitions only. It must not
re-export `validationPlugin`, `middlewarePlugin`, or `superJsonCodec` because doing so risks pulling heavy
feature modules into small browser bundles.

## Plugin Surface

The core should expose one plugin abstraction with narrowly scoped hooks. The hook names describe RPC
lifecycle points, not specific features.

```ts
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
```

Hook semantics:

- `onRequest` runs on the receiving side after callback restoration and before handler execution.
- `wrapHandler` composes around the exposed handler using onion order. It can inspect or transform args,
  block calls, call `next()`, or transform the result.
- `onResponse` runs after handler execution and before the response is sent. It can validate or transform
  output.
- `onError` runs when handler execution or plugin logic throws. It can replace `ctx.error`, attach
  diagnostic fields, or observe errors.

Context objects are intentionally mutable. The core must read `ctx.args`, `ctx.value`, `ctx.result`, and
`ctx.error` after hooks run so plugins can transform values without adding separate return conventions for
each hook. `wrapHandler` still returns the handler result because onion middleware naturally composes
through `return await next()`.

The first slice only needs receiving-side hooks because validation and middleware happen where the API is
exposed. Later client-side hooks can be added for outbound metadata or tracing without changing the
feature modules.

## Core Option Shape

`RPCChannelOptions` should gain `plugins?: RPCPlugin[]` without adding feature-specific fields.

```ts
const channel = new RPCChannel(transport, {
	expose: api,
	plugins: [validationPlugin(validators), middlewarePlugin(interceptors)]
})
```

`wrap()` and `expose()` should accept the same plugin-capable option shape:

```ts
const api = wrap<RemoteAPI>(transport, { plugins: [clientTracingPlugin()] })
const controller = expose(localApi, transport, { plugins: [validationPlugin(validators)] })
```

Client-side plugins are reserved for later hooks. Passing a receiving-side plugin to a client-only channel
is harmless; its hooks simply do not run until that channel receives requests.

## Validation Plugin

Entry: `kkrpc/next/validation`

Exports:

```ts
validationPlugin(validators): RPCPlugin
RPCValidationError
isRPCValidationError
defineMethod
defineAPI
extractValidators
type RPCValidators
type MethodValidators
type InferAPI
type StandardSchemaV1
```

Behavior:

- Input validation runs in `onRequest` for `operation === "call"` and `operation === "new"` when a
  validator exists for that path.
- Output validation runs in `onResponse` for `operation === "call"` and `operation === "new"` when an
  output schema exists.
- `kkrpc/next/validation` should support constructor validators if the exposed API type has constructor
  signatures. If TypeScript inference becomes too complex for the first slice, runtime validators by path
  are still supported and typed constructor validator inference can follow.
- Getter and setter property validation is deferred until a property-validator shape is designed. The
  current classic validator type already focuses on method-like calls.
- Callback args are already restored to functions by core; validation filters callbacks the same way
  classic `validation.ts` does.
- Validation errors use `RPCValidationError` and should serialize through the current vNext error object
  shape. A later rich-error plugin can preserve custom properties more completely.

Example:

```ts
import { expose } from "kkrpc/next"
import { validationPlugin, extractValidators } from "kkrpc/next/validation"

const api = defineAPI({
	add: defineMethod(
		{ input: z.tuple([z.number(), z.number()]), output: z.number() },
		async (a, b) => a + b
	)
})

expose(api, transport, {
	plugins: [validationPlugin(extractValidators(api))]
})
```

## Middleware Plugin

Entry: `kkrpc/next/middleware`

Exports:

```ts
middlewarePlugin(interceptors): RPCPlugin
runInterceptors
type RPCInterceptor
type RPCCallContext
```

Behavior:

- Middleware is implemented through `wrapHandler`.
- It uses the existing onion model from classic `middleware.ts`.
- It runs after input validation and before output validation when plugin order is
  `[validationPlugin(), middlewarePlugin()]`.
- Plugin order is user-controlled, but docs should recommend validation before middleware for validated
  args and validation after middleware for validated transformed output.

Example:

```ts
expose(api, transport, {
	plugins: [
		validationPlugin(validators),
		middlewarePlugin([
			async (ctx, next) => {
				const start = performance.now()
				try {
					return await next()
				} finally {
					console.log(ctx.method, performance.now() - start)
				}
			}
		])
	]
})
```

## SuperJSON Codec

Entry: `kkrpc/next/superjson`

Exports:

```ts
superJsonCodec<TMessage>(): Codec<TMessage, string>
superJsonLineCodec<TMessage>(): Codec<TMessage, string>
```

Behavior:

- `superJsonCodec` uses `superjson.stringify` and `superjson.parse`.
- `superJsonLineCodec` adds trailing newline framing for stream transports.
- Both codecs advertise `transfer: false` because string codecs cannot forward transferable objects.
- Object-mode transports should keep using `objectCodec` when transfer is needed.
- Users who need both SuperJSON and zero-copy transfer will need a future structured SuperJSON envelope or
  rich transfer codec. That is out of the first slice.

Example:

```ts
import { createTransport } from "kkrpc/next/transport"
import { superJsonLineCodec } from "kkrpc/next/superjson"

const transport = createTransport({
	platform: stdioPlatform({ readable, writable }),
	codec: superJsonLineCodec()
})
```

## Classic Compatibility Facade

Entry: `kkrpc/next/classic-compat`

This module exists for migration convenience. It can import feature modules because users opt into it
explicitly.

Exports:

```ts
classicPlugins(options): RPCPlugin[]
createCompatChannel(transport, options): RPCChannel
wrapCompat(transport, options): RemoteAPI
exposeCompat(api, transport, options): ExposedController
```

Example option shape:

```ts
interface ClassicCompatOptions<LocalAPI extends object = object> extends RPCChannelOptions<LocalAPI> {
	validators?: RPCValidators<LocalAPI>
	interceptors?: RPCInterceptor[]
}
```

Compatibility rules:

- `validators` translates to `validationPlugin(validators)`.
- `interceptors` translates to `middlewarePlugin(interceptors)`.
- `plugins` are appended after translated plugins unless the facade documents a different order.
- `serialization.version = "superjson"` is not translated inside `createCompatChannel` because codecs are
  transport-level. The facade can provide transport helpers such as `stdioCompatTransport({ version:
  "superjson" })` later, but it should not hide platform/codec composition in the first slice.

This keeps migration ergonomic without making `kkrpc/next` itself carry compatibility code.

## Future Feature Placement

Metadata and tracing:

- Add client-side `onSendRequest` and receiving-side `onReceiveRequest` hooks later.
- Metadata should be an optional protocol field, not a required core concept.

Streaming:

- Add a streaming plugin plus protocol extension messages such as stream chunk/end/error.
- Do not add AsyncIterable handling to the small core until a plugin can own the extra state.

Rich transfer handlers:

- Add a structured codec or transfer plugin that uses tagged placeholder objects and transfer slots.
- Keep it separate from `objectCodec` so simple object-mode transports stay tiny.

Broadcast:

- Add a broadcast plugin or transport helper that only works when `transport.capabilities.broadcast` is
  true.
- Core should not include broadcast behavior by default.

## Testing Strategy

Core plugin runner tests:

- plugin hook order
- `wrapHandler` onion behavior
- plugin transforms args/result
- plugin thrown errors reach caller
- no plugin import increases `kkrpc/next` dependency graph with validation/middleware/SuperJSON

Validation tests:

- input validation failure
- output validation failure
- nested method lookup
- callback argument filtering
- schema-first `defineMethod` / `extractValidators`

Middleware tests:

- interceptor order
- interceptor can block a call
- interceptor can transform result
- context includes request id, method path, args, and shared state

SuperJSON tests:

- Date, Map, Set, BigInt round-trip over `superJsonCodec`
- `superJsonLineCodec` over stdio-style platform
- bundle benchmark shows `kkrpc/next` does not include `superjson`, while `kkrpc/next/superjson` does

Compat tests:

- `classicPlugins({ validators, interceptors })` creates working plugins
- `createCompatChannel` preserves basic migration ergonomics
- compat entry does not affect `kkrpc/next` bundle size

## Bundle Expectations

The benchmark script should add optional rows for:

- `kkrpc/next` core
- `kkrpc/next/validation`
- `kkrpc/next/middleware`
- `kkrpc/next/superjson`
- `kkrpc/next/classic-compat`

Expected dependency behavior:

- `kkrpc/next` must not include `superjson`, classic `channel-core`, classic validation, or classic
  middleware implementation unless those are explicitly imported.
- `kkrpc/next/validation` may include Standard Schema helper code but no schema library dependency.
- `kkrpc/next/middleware` should be very small.
- `kkrpc/next/superjson` includes `superjson` only in that entry or user bundles that import it.
- `kkrpc/next/classic-compat` may include validation and middleware modules because it is an explicit
  migration facade.

## First Implementation Slice

Implement in this order:

1. Add plugin types and runner to `src/next/plugins.ts`, exported by `kkrpc/next/plugins` and as types from
   `kkrpc/next`.
2. Add `plugins?: RPCPlugin[]` to `RPCChannelOptions`, `wrap`, and `expose`.
3. Insert receiving-side hook execution into `RPCChannel.executeRequest()` and `handleRequest()`.
4. Add `kkrpc/next/validation` by adapting classic `validation.ts` without importing it from core.
5. Add `kkrpc/next/middleware` by adapting classic `middleware.ts` without importing it from core.
6. Add `kkrpc/next/superjson` codecs.
7. Add `kkrpc/next/classic-compat` facade for validators/interceptors only.
8. Add tests and bundle benchmark rows proving modularity.

## Acceptance Criteria

- `kkrpc/next` remains small and does not import feature modules.
- Users can opt into validation, middleware, and SuperJSON with separate imports.
- Validation and middleware can be combined on the same exposed API.
- SuperJSON works through codec composition.
- Compatibility facade exists for old validators/interceptors migration.
- Focused tests, typecheck, package export verification, and bundle comparison pass.
- Bundle contributor tables prove feature modules are absent from `kkrpc/next` unless imported.
