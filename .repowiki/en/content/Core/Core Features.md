# Core Features

<cite>
**Referenced Files in This Document**
- [packages/kkrpc/src/core/index.ts](file://packages/kkrpc/src/core/index.ts)
- [packages/kkrpc/src/core/channel.ts](file://packages/kkrpc/src/core/channel.ts)
- [packages/kkrpc/src/core/protocol.ts](file://packages/kkrpc/src/core/protocol.ts)
- [packages/kkrpc/src/core/plugins.ts](file://packages/kkrpc/src/core/plugins.ts)
- [packages/kkrpc/src/core/transfer.ts](file://packages/kkrpc/src/core/transfer.ts)
- [packages/kkrpc/src/core/codecs.ts](file://packages/kkrpc/src/core/codecs.ts)
- [packages/kkrpc/src/core/transport.ts](file://packages/kkrpc/src/core/transport.ts)
- [packages/kkrpc/src/core/remote-ref.ts](file://packages/kkrpc/src/core/remote-ref.ts)
- [packages/kkrpc/src/features/validation.ts](file://packages/kkrpc/src/features/validation.ts)
- [packages/kkrpc/src/features/middleware.ts](file://packages/kkrpc/src/features/middleware.ts)
- [packages/kkrpc/src/features/superjson.ts](file://packages/kkrpc/src/features/superjson.ts)
</cite>

## Table of Contents

1. [RPCChannel](#rpcchannel)
2. [Wrap, Expose, and Dispose](#wrap-expose-and-dispose)
3. [Remote API Proxies](#remote-api-proxies)
4. [Message Metadata](#message-metadata)
5. [Runtime Validation](#runtime-validation)
6. [Middleware](#middleware)
7. [Transferable Objects](#transferable-objects)
8. [Codecs and Transport Composition](#codecs-and-transport-composition)
9. [MP Message Metadata](#message-metadata-1)

## RPCChannel

`RPCChannel<LocalAPI, RemoteAPI>` is the central class that owns one `Transport<RPCMessage>`, exposes an optional local API, and creates a typed proxy for the remote API. It handles request/response matching, callback argument routing, transfer descriptors, timeouts, plugin hooks, and lifecycle cleanup.

```typescript
const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, {
	expose: localAPI,
	timeout: 30000,
	plugins: [validationPlugin(validators)],
	getMetadata: () => ({ requestId: crypto.randomUUID() })
})
const remote = channel.getAPI()
await remote.ping()
channel.destroy()
```

### Key Methods

- **`getAPI()`** — Returns a nested `Proxy` that translates property access, function calls, and constructor calls into protocol messages.
- **`destroy()`** — Tears down the channel: unsubscribes from the transport, rejects all pending requests, clears callbacks, and calls `transport.close()`.
- **`request(op, path, args?, value?)`** — Sends one RPC request and returns a pending promise. Used internally by the proxy implementation.

### Constructor Options

| Option           | Type                       | Default     | Description                         |
| ---------------- | -------------------------- | ----------- | ----------------------------------- |
| `expose`         | `LocalAPI`                 | `undefined` | Local API object to expose          |
| `timeout`        | `number`                   | `30000`     | Request timeout in ms (0 = disable) |
| `enableTransfer` | `boolean`                  | `true`      | Enable transferable forwarding      |
| `plugins`        | `RPCPlugin[]`              | `[]`        | Receive-side plugin hooks           |
| `getMetadata`    | `() => RPCMessageMetadata` | `undefined` | Protocol-level metadata provider    |

**Section sources**

- [packages/kkrpc/src/core/channel.ts](file://packages/kkrpc/src/core/channel.ts#L1-L488)
- [packages/kkrpc/src/core/channel.ts](file://packages/kkrpc/src/core/channel.ts#L38-L50)
- [packages/kkrpc/src/core/channel.ts](file://packages/kkrpc/src/core/channel.ts#L178-L224)

## Wrap, Expose, and Dispose

The `core/index.ts` module provides three convenience functions built on top of `RPCChannel`:

- **`wrap<RemoteAPI>(transport, options)`** — Creates a typed client proxy without exposing a local API. The proxy is registered in a `WeakMap` for automatic disposal tracking.
- **`expose<LocalAPI>(api, transport, options)`** — Creates a channel that exposes a local API and returns an `ExposedController` with the underlying channel and a `dispose()` method.
- **`dispose(api)`** — Destroys the channel associated with a proxy created by `wrap()`.

```typescript
// Client-only usage
const api = wrap<RemoteAPI>(webSocketClientTransport({ url }))
console.log(await api.ping())
dispose(api)

// Server usage
const controller = expose(mathAPI, webSocketTransport(socket))
controller.dispose()
```

**Section sources**

- [packages/kkrpc/src/core/index.ts](file://packages/kkrpc/src/core/index.ts#L57-L107)
- [packages/kkrpc/src/core/index.ts](file://packages/kkrpc/src/core/index.ts#L73-L81)
- [packages/kkrpc/src/core/index.ts](file://packages/kkrpc/src/core/index.ts#L89-L99)

## Remote API Proxies

`RPCChannel.getAPI()` returns a nested proxy built with JavaScript `Proxy` traps. The proxy translates operations into compact protocol messages:

- **Property access (`get`)** — Returns a deeper proxy. If the property is `then` and the path is non-empty, it issues a `get` request and returns a `.then`-able promise for `await api.some.property`.
- **Property assignment (`set`)** — Issues a `set` request with the value.
- **Function invocation (`apply`)** — Issues a `call` request with the arguments array.
- **Constructor call (`construct`)** — Issues a `new` request with the arguments array.

Arguments are encoded with `encodeArgs()`, which wraps callback functions in special `__kkrpc_next_arg__` envelope records and wraps static values in `__kkrpc_next_arg__` value envelopes, preventing user data from being confused with callback markers.

**Section sources**

- [packages/kkrpc/src/core/channel.ts](file://packages/kkrpc/src/core/channel.ts#L226-L247)
- [packages/kkrpc/src/core/channel.ts](file://packages/kkrpc/src/core/channel.ts#L444-L473)

## Runtime Validation

Validation is an optional feature implemented as an `RPCPlugin`. It supports two usage patterns:

### Type-First Validation

Provide a `ValidatorMap<API>` that mirrors the API type at runtime:

```typescript
import { validationPlugin, type ValidatorMap } from "kkrpc/validation"

interface MathAPI {
	add(a: number, b: number): Promise<number>
}

const validators: ValidatorMap<MathAPI> = {
	add: { input: z.tuple([z.number(), z.number()]), output: z.number() }
}
expose(api, transport, { plugins: [validationPlugin(validators)] })
```

### Schema-First Validation

Define methods with `defineMethod()` and extract validators automatically:

```typescript
import { defineAPI, defineMethod, extractValidators, validationPlugin } from "kkrpc/validation"

const api = defineAPI({
	add: defineMethod(
		{ input: z.tuple([z.number(), z.number()]), output: z.number() },
		async (a, b) => a + b
	)
})
expose(api, transport, { plugins: [validationPlugin(extractValidators(api))] })
```

The validation plugin:

- Runs input validation before handler invocation via `onRequest`
- Runs output validation after handler returns via `onResponse`
- Throws `RPCValidationError` on failure, preserving `phase`, `method`, and Standard Schema `issues`
- Filters callback function arguments before input validation
- Writes transformed values back into the argument/result context

**Section sources**

- [packages/kkrpc/src/features/validation.ts](file://packages/kkrpc/src/features/validation.ts#L1-L508)
- [packages/kkrpc/src/features/validation.ts](file://packages/kkrpc/src/features/validation.ts#L430-L451)
- [packages/kkrpc/src/features/validation.ts](file://packages/kkrpc/src/features/validation.ts#L497-L508)

## Middleware

Middleware is an optional feature implemented as an `RPCPlugin` using `wrapHandler`. Interceptors run in onion order:

```typescript
import { middlewarePlugin, type MiddlewareHandler } from "kkrpc/middleware"

const logger: MiddlewareHandler = async (ctx, next) => {
	console.time(ctx.method)
	try {
		return await next()
	} finally {
		console.timeEnd(ctx.method)
	}
}

expose(api, transport, { plugins: [middlewarePlugin([logger])] })
```

Each interceptor receives an `RPCCallContext` with the method path, decoded arguments, metadata, and a mutable `state` bag. Not calling `next()` short-circuits handler invocation. Calling `next()` more than once throws an error.

**Section sources**

- [packages/kkrpc/src/features/middleware.ts](file://packages/kkrpc/src/features/middleware.ts#L1-L98)
- [packages/kkrpc/src/features/middleware.ts](file://packages/kkrpc/src/features/middleware.ts#L56-L70)
- [packages/kkrpc/src/features/middleware.ts](file://packages/kkrpc/src/features/middleware.ts#L79-L98)

## Transferable Objects

Transferable objects are supported through a `WeakMap<object, TransferDescriptor>` mechanism:

1. The user calls `transfer(value, [transferables])` to mark an object
2. `RPCChannel.encodeValue()` checks for transfer descriptors with `takeTransferDescriptor()`
3. If found, the descriptor's value is encoded, and transferables are collected
4. During `transport.send()`, transferables are forwarded when both the platform and codec advertise `transfer: true`

```typescript
import { transfer } from "kkrpc"

const buffer = new ArrayBuffer(1024)
await remote.upload(transfer(buffer, [buffer]))
```

Transfer support is gated by transport capabilities. The channel only forwards transferables when `transport.capabilities.transfer === true` and `enableTransfer` is not disabled in options.

**Section sources**

- [packages/kkrpc/src/core/transfer.ts](file://packages/kkrpc/src/core/transfer.ts#L1-L51)
- [packages/kkrpc/src/core/channel.ts](file://packages/kkrpc/src/core/channel.ts#L476-L487)
- [packages/kkrpc/src/core/channel.ts](file://packages/kkrpc/src/core/channel.ts#L199-L202)

## Codecs and Transport Composition

The `createTransport()` function composes a `Platform<TWire>` and `Codec<TMessage, TWire>` into a message-level `Transport<RPCMessage>`:

```typescript
import { jsonLineCodec } from "kkrpc/codecs"
import { stdioPlatform } from "kkrpc/stdio"
import { createTransport } from "kkrpc/transport"

const transport = createTransport({
	platform: stdioPlatform({ readable, writable }),
	codec: jsonLineCodec()
})
```

Built-in codecs:

| Codec                  | Input Type | Output Type | Transfer Support            |
| ---------------------- | ---------- | ----------- | --------------------------- |
| `objectCodec()`        | `TMessage` | `TMessage`  | Yes (identity pass-through) |
| `jsonCodec()`          | `TMessage` | `string`    | No (JSON serialization)     |
| `jsonLineCodec()`      | `TMessage` | `string`    | No (JSON + newline)         |
| `superJsonCodec()`     | `TMessage` | `string`    | No (SuperJSON)              |
| `superJsonLineCodec()` | `TMessage` | `string`    | No (SuperJSON + newline)    |

**Section sources**

- [packages/kkrpc/src/core/transport.ts](file://packages/kkrpc/src/core/transport.ts#L90-L121)
- [packages/kkrpc/src/core/codecs.ts](file://packages/kkrpc/src/core/codecs.ts#L17-L54)
- [packages/kkrpc/src/features/superjson.ts](file://packages/kkrpc/src/features/superjson.ts#L31-L58)

## Message Metadata

kkrpc v2.0.0 supports protocol-level metadata attached to outgoing requests. The `RPCMessageMetadata` interface includes:

- `traceparent` / `tracestate` — W3C trace context headers
- `baggage` — W3C baggage header
- `requestId` — Application request ID for log correlation
- `sessionId` — Session ID for grouping related calls
- `runtime` — Runtime-specific low-cardinality metadata

```typescript
const channel = new RPCChannel(transport, {
	getMetadata: () => ({
		requestId: crypto.randomUUID(),
		traceparent: `00-${traceId}-${spanId}-01`
	})
})
```

Metadata propagates through request messages and is available in plugin `onRequest` contexts as `ctx.meta`. Transports are not required to preserve metadata during relay.

**Section sources**

- [packages/kkrpc/src/core/protocol.ts](file://packages/kkrpc/src/core/protocol.ts#L28-L43)
- [packages/kkrpc/src/core/channel.ts](file://packages/kkrpc/src/core/channel.ts#L251-L263)
