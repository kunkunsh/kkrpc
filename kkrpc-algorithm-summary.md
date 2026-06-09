# kkrpc Algorithm Summary

## Overview

kkrpc stable is a TypeScript-first bidirectional RPC library built around native transports, compact JSON messages, proxy-based remote APIs, plugin hooks, runtime validation, middleware, and optional transferable support. The stable architecture centers on `RPCChannel` plus `Transport<RPCMessage>` instead of the previous public adapter interface.

## Core Components

### RPCChannel (`packages/kkrpc/src/core/channel.ts`)

`RPCChannel<LocalAPI, RemoteAPI>` owns the RPC state machine:

- `pending`: tracks outbound requests until matching responses arrive.
- `callbacks`: stores local callback arguments that remote peers can invoke.
- `destroyed`: prevents calls after shutdown and rejects pending calls during destroy.
- `supportsTransfer`: enables transferable forwarding only when the transport advertises transfer support.
- `timeout`: per-call timeout, defaulting to `30_000` ms; non-positive values disable timeouts.
- `plugins`: request, handler, response, and error hooks used by validation, middleware, and inspection features.

The channel subscribes to the transport in the constructor and dispatches each incoming `RPCMessage` by its compact `t` discriminator.

### Transport (`packages/kkrpc/src/core/transport.ts`)

Stable transports expose a small message-oriented API:

```typescript
interface Transport<T> {
	capabilities?: TransportCapabilities
	send(message: T, transferables?: Transferable[]): void | Promise<void>
	subscribe(listener: (message: T) => void): () => void
	close?(): void
}
```

`createTransport()` composes a lower-level `Platform<Wire>` with a `Codec<Message, Wire>`. This keeps transport-specific IO separate from RPC message encoding.

### Stable Entry Points

- `kkrpc`: core exports such as `RPCChannel`, `wrap`, `expose`, `dispose`, and `transfer`.
- `kkrpc/browser`: browser-safe core exports.
- `kkrpc/stdio`: `nodeStdioTransport()` and `stdioJsonTransport()`.
- `kkrpc/ws`: `webSocketTransport()` and `webSocketClientTransport()`.
- `kkrpc/http`: HTTP client/server transport helpers.
- `kkrpc/worker`, `kkrpc/iframe`, `kkrpc/chrome-extension`, and runtime integration subpaths provide additional native transport factories.

## Stable Protocol

Stable messages are compact records defined in `packages/kkrpc/src/core/protocol.ts`:

```typescript
type RPCOperation = "call" | "get" | "set" | "new"

interface RPCRequest {
	t: "q"
	id: string
	op: RPCOperation
	p: string[]
	a?: unknown[]
	v?: unknown
}

interface RPCResponse {
	t: "r"
	id: string
	v?: unknown
	e?: { n: string; m: string; s?: string; [key: string]: unknown }
}

interface RPCCallback {
	t: "cb"
	id: string
	a: unknown[]
}
```

There are no stable first-class stream message types. APIs that need continuous updates should use callback arguments, evented transports, polling, or explicit chunk/result arrays until native streaming is added with protocol and tests.

## Request Flow

### Remote Call

```typescript
const api = wrap<RemoteAPI>(transport)
await api.user.create({ name: "Alice" })
```

Internal flow:

1. A nested proxy captures the path `['user', 'create']` and operation `call`.
2. `RPCChannel` creates a request id and stores a pending promise.
3. Callback arguments become callback envelopes and are stored in `callbacks`.
4. Values marked with `transfer()` are encoded only if the transport supports transfer.
5. The channel sends `{ t: 'q', id, op: 'call', p, a }` through the transport.
6. The timeout timer rejects with an `Error` named `RPCTimeoutError` if no response arrives in time.

### Incoming Request

Incoming requests run through this sequence:

1. Decode argument envelopes into values and callback stubs.
2. Run plugin `onRequest` hooks.
3. Resolve the target path on the exposed local API.
4. Run plugin `wrapHandler` hooks around the actual handler.
5. Run plugin `onResponse` hooks and send `{ t: 'r', id, v }`.
6. If any step throws, run plugin `onError` hooks and send `{ t: 'r', id, e }`.

### Response Handling

Responses look up the matching pending request by `id`, clear its timeout, and either resolve with `v` or reject with an `Error` reconstructed from `e.n`, `e.m`, and `e.s`.

### Callback Handling

Function arguments are encoded as callback envelopes. When the remote peer invokes a callback stub, it sends `{ t: 'cb', id, a }`. The owning channel looks up the stored function and calls it with decoded arguments.

## Proxy Semantics

kkrpc remote APIs are lazy nested proxies:

- Property access extends the path.
- Awaiting a non-root property performs `get`.
- Assignment performs `set` fire-and-forget.
- Calling a proxy performs `call`.
- Constructing a proxy performs `new`.

## Plugins, Validation, And Middleware

Plugins are the stable extension point. Validation and middleware are implemented as plugins rather than hard-coded channel features.

```typescript
interface RPCPlugin {
	onRequest?(ctx): void | Promise<void>
	wrapHandler?(ctx, next): unknown | Promise<unknown>
	onResponse?(ctx): void | Promise<void>
	onError?(ctx): void | Promise<void>
}
```

Validation plugins can check input and output schemas. Middleware plugins can log calls, enforce auth, rate-limit requests, transform results, or attach per-request state.

## Transferables

`transfer(value, descriptor?)` marks objects in a WeakMap. During request or response encoding, `RPCChannel` consumes the descriptor and appends the transferable to the send call only when `transport.capabilities?.transfer === true`. Unsupported transports automatically carry the value through the normal codec path.

## Transport Examples

### Stdio

`nodeStdioTransport()` binds `process.stdin` and `process.stdout` to JSON-line `RPCMessage` records. `stdioJsonTransport({ readable, writable })` supports custom Node-style streams.

### WebSocket

`webSocketTransport(socket)` serializes each `RPCMessage` with `JSON.stringify`, listens to browser-style or Node `ws` message events, and queues outbound messages until the socket is open. `webSocketClientTransport({ url })` creates a client-side WebSocket transport.

### HTTP

The HTTP transport uses request/response semantics for each RPC request and maps RPC timeout errors to HTTP 504 responses.

## Error Handling

Errors are serialized as compact records with name, message, stack, and enumerable custom fields. Remote errors are reconstructed as `Error` objects with the original `name` restored.

Write failures reject the associated pending request immediately. Destroying a channel unsubscribes from the transport, rejects all pending calls, clears callbacks, and closes the transport if supported.

## Current Stable Limitations

- No first-class remote iterator or stream protocol.
- No public stable legacy adapter layer.
- Cross-language implementations should target the compact JSON `RPCMessage` protocol first.
