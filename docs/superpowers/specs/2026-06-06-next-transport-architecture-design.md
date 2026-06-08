# kkrpc Next Transport Architecture Design

## Goal

Design a `kkrpc/next` public preview that can become the next major kkrpc architecture. The design
keeps the small, composable shape proven by `kkrpc/browser-mini`, but makes it cross-runtime by
separating RPC behavior from platform transports and wire codecs.

The new architecture should provide convenient Comlink/Comctx-style APIs such as `wrap()` and
`expose()`, while keeping a low-level `RPCChannel` API for advanced cases like connecting to several
child processes over different stdin/stdout streams.

## Non-Goals

This preview does not replace the current `kkrpc` main entry immediately. Existing `kkrpc`,
`kkrpc/browser`, and `kkrpc/browser-lite` behavior stays unchanged during the preview phase.

This design does not attempt to port every current `RPCChannelCore` feature into vNext at once.
Validation, middleware, streaming, metadata, rich transfer handlers, SuperJSON, and broadcast behavior
should be designed as opt-in features or codecs after the core transport model is stable.

## Current Context

The current full `IoInterface` mixes several responsibilities:

- Platform communication: Worker, WebSocket, stdio, iframe, Chrome extension, Electron, and queues.
- Wire format: structured-clone objects, JSON strings, SuperJSON strings, and structured envelopes.
- Framing and lifecycle: newline buffering, read queues, destroy signals, EOF handling, and errors.
- Core RPC features: request/response, callbacks, property access, constructors, transfer slots,
  validation, middleware, streaming, and broadcast handling.

This makes the shared `channel-core.ts` hard to tree-shake because one class statically references most
features. The `browser-mini` proof of concept shows that a smaller core can be much smaller when it
only depends on an event-based transport and a compact message protocol.

The current stdio adapters also show why high-level shorthand cannot be the only API. `NodeIo` accepts
explicit read/write streams and can talk to many child processes, but `DenoIo` and `BunIo` are more
global-stdout-oriented. vNext must preserve explicit stream injection for advanced users.

## Naming And Release Shape

Use `kkrpc/next` as a public preview entry in the next minor release. It communicates that the API is
the intended future architecture without immediately breaking the current stable entrypoints.

Preview entries:

```ts
kkrpc/next
kkrpc/next/worker
kkrpc/next/websocket
kkrpc/next/stdio
kkrpc/next/chrome-extension
kkrpc/next/transport
kkrpc/next/codecs
```

`kkrpc/browser-mini` remains a size proof-of-concept. New cross-runtime work should happen under
`kkrpc/next`, not by expanding the long-term meaning of `mini`.

## Architecture

The architecture has three layers:

```ts
RPC API -> Transport -> Platform + Codec
```

`RPCChannel`, `wrap()`, and `expose()` consume a single normalized `Transport<RPCMessage>`.

`Transport` can be provided directly by a platform that already sends JavaScript objects, or it can be
composed from a low-level platform plus a wire codec.

```ts
export interface Transport<TMessage> {
	send(message: TMessage, transfers?: Transferable[]): void | Promise<void>
	subscribe(listener: (message: TMessage) => void): () => void
	close?(): void
	capabilities?: TransportCapabilities
}

export interface TransportCapabilities {
	objectMode?: boolean
	transfer?: boolean
	broadcast?: boolean
}

export interface Platform<TWire> {
	send(wire: TWire, transfers?: Transferable[]): void | Promise<void>
	subscribe(listener: (wire: TWire) => void): () => void
	close?(): void
	capabilities?: PlatformCapabilities
}

export interface PlatformCapabilities {
	objectMode?: boolean
	transfer?: boolean
}

export interface Codec<TMessage, TWire> {
	encode(message: TMessage): TWire
	decode(wire: TWire): TMessage
	capabilities?: CodecCapabilities
}

export interface CodecCapabilities {
	transfer?: boolean
}
```

Composition API:

```ts
export function createTransport<TMessage, TWire>(options: {
	platform: Platform<TWire>
	codec: Codec<TMessage, TWire>
}): Transport<TMessage>
```

If a platform already sends object messages, a codec is optional because the platform can directly
implement `Transport<RPCMessage>`.

Composed transports should forward transferable objects only when both the platform and codec
explicitly advertise `transfer: true`. Unknown capabilities default to no transfer forwarding.

## Public RPC API

The low-level API remains `RPCChannel` for full control:

```ts
const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, {
	expose: localApi,
	timeout: 1000,
	enableTransfer: true
})

const api = channel.getAPI()
```

The convenience API mirrors Comlink and Comctx:

```ts
const api = wrap<RemoteAPI>(transport, { timeout: 1000 })
const controller = expose<LocalAPI>(localApi, transport)
dispose(api)
```

`wrap()` is a thin shorthand for creating a channel without an exposed local API and returning
`channel.getAPI()`. It registers the returned proxy in an internal `WeakMap` so `dispose(api)` can
release the hidden channel without adding a public property that may conflict with a remote API path.

`expose()` is a thin shorthand for creating a channel with an exposed API and returning a controller:

```ts
export interface ExposedController<LocalAPI extends object, RemoteAPI extends object = object> {
	channel: RPCChannel<LocalAPI, RemoteAPI>
	dispose(): void
}
```

This avoids making shorthand APIs less capable than `RPCChannel`. If a user needs bidirectional APIs,
custom channel ownership, or direct access to both local and remote APIs, they use `RPCChannel`
directly. The first preview keeps `expose()` one-way and controller-oriented rather than returning a
remote API from `expose()`.

## RPC Core Feature Set

The initial `kkrpc/next` core should support the same core behaviors already proven by
`browser-mini`:

- method calls
- nested paths
- callback arguments
- getter via `await api.path.value`
- assignment setter
- constructor via `await new api.Ctor(...)`
- timeout rejection
- destroy/dispose cleanup
- write failure rejection
- parent-bound method `this`
- top-level marked transfer when the transport supports transfer

The initial core should not include validation, middleware, streaming, metadata, SuperJSON, rich
transfer handlers, or broadcast behavior by default. Those should be layered as optional features or
codecs.

## Wire Protocol

Use the compact `browser-mini` message protocol as the vNext baseline:

```ts
type RPCMessage =
	| { t: "q"; id: string; op: "call" | "get" | "set" | "new"; p: string[]; a?: unknown[]; v?: unknown }
	| { t: "r"; id: string; v?: unknown; e?: RPCError }
	| { t: "cb"; id: string; a: unknown[] }

interface RPCError {
	n: string
	m: string
	s?: string
}
```

This protocol remains JSON-safe by default except for values that only object-mode transports can carry.
JSON codecs must disable transfer and document JSON-safe value restrictions.

## Codec Presets

Built-in codecs should be small and explicit:

```ts
objectCodec(): Codec<RPCMessage, RPCMessage>
jsonCodec(): Codec<RPCMessage, string>
jsonLineCodec(): Codec<RPCMessage, string>
```

`objectCodec()` is a no-op codec for platforms that send JavaScript objects.

`jsonCodec()` uses `JSON.stringify` and `JSON.parse`. It supports plain JSON-safe values and callback
ids because callbacks are replaced by protocol placeholders before encoding. It does not support
transfer, `BigInt`, `Date`, `Map`, `Set`, class instances, or cyclic objects unless a future codec adds
that behavior.

`jsonLineCodec()` wraps `jsonCodec()` with newline framing for stream transports such as stdio. The
framing code belongs in the platform or codec composition, not in `RPCChannel`.

Future codecs can include:

```ts
superJsonCodec()
binaryCodec()
```

These must stay optional so users do not pay for them in small bundles.

## Platform Presets

Provide batteries-included presets so most users do not need to write adapters.

Worker object mode:

```ts
const api = wrap<WorkerAPI>(workerTransport(worker))
expose(apiImpl, workerSelfTransport())
```

WebSocket JSON:

```ts
const api = wrap<ServerAPI>(webSocketJsonTransport(socket))
```

Chrome extension messaging:

```ts
const api = wrap<BackgroundAPI>(chromeRuntimeTransport(browser.runtime))
expose(backgroundApi, chromeRuntimeTransport(browser.runtime))
```

Node child process stdio:

```ts
const child = spawn("node", ["worker.js"], {
	stdio: ["pipe", "pipe", "inherit"]
})

const api = wrap<WorkerAPI>(
	stdioJsonTransport({
		readable: child.stdout,
		writable: child.stdin
	})
)
```

Current process stdio shortcut:

```ts
expose(api, nodeStdioTransport())
```

Deno and Bun should support both explicit streams and defaults:

```ts
stdioJsonTransport({ readable, writable })
denoStdioTransport()
bunStdioTransport()
```

The explicit `stdioJsonTransport({ readable, writable })` form is the important primitive. Runtime
shortcuts are convenience wrappers that fill in default stdin/stdout.

## Stdio Design

Stdio must support multiple processes and arbitrary streams. Do not design stdio around global process
stdin/stdout only.

The low-level platform should accept an explicit stream pair:

```ts
export interface StdioPlatformOptions {
	readable: ReadableLike
	writable: WritableLike
}

stdioPlatform(options: StdioPlatformOptions): Platform<string>
stdioJsonTransport(options: StdioPlatformOptions): Transport<RPCMessage>
```

Runtime shortcuts:

```ts
nodeStdioTransport(options?: Partial<StdioPlatformOptions>): Transport<RPCMessage>
denoStdioTransport(options?: Partial<StdioPlatformOptions>): Transport<RPCMessage>
bunStdioTransport(options?: Partial<StdioPlatformOptions>): Transport<RPCMessage>
```

If options are provided, they override defaults. This lets a user connect to many child processes with
the same API.

## Entry Point Strategy

Keep entrypoints small and tree-shakable:

```ts
kkrpc/next                // RPCChannel, wrap, expose, core types only
kkrpc/next/worker         // workerTransport, workerSelfTransport
kkrpc/next/websocket      // webSocketPlatform, webSocketJsonTransport
kkrpc/next/stdio          // stdioPlatform, stdioJsonTransport, runtime shortcuts
kkrpc/next/chrome-extension
kkrpc/next/transport      // createTransport, Platform, Transport
kkrpc/next/codecs         // objectCodec, jsonCodec, jsonLineCodec
```

Avoid exporting all platform presets from `kkrpc/next` because that would recreate the current
bundle-size problem.

## Migration Path

Preview phase:

```ts
import { wrap, expose, RPCChannel } from "kkrpc/next"
```

Current stable APIs remain:

```ts
import { RPCChannel } from "kkrpc"
import { RPCChannel } from "kkrpc/browser"
import { RPCChannel } from "kkrpc/browser-lite"
```

Future major release can promote vNext to the main entry:

```ts
import { wrap, expose, RPCChannel } from "kkrpc"
```

The old full architecture can remain available as `kkrpc/classic` or as compatibility entrypoints if
needed.

## Relationship To browser-mini

`browser-mini` proves the small core and compact protocol. `kkrpc/next` should reuse the lessons but
not necessarily reuse the exact file layout or public name.

The first `kkrpc/next` implementation may share internal code with `browser-mini` if it does not pull
in browser-only assumptions. Once vNext exists, `browser-mini` can either stay as a narrow browser-only
entry or become a compatibility wrapper around `kkrpc/next/worker`.

## Testing And Benchmarking

Tests should cover both shorthand and low-level APIs:

- `wrap(workerTransport(worker))`
- `expose(api, workerSelfTransport())`
- `new RPCChannel(transport, { expose })`
- `stdioJsonTransport({ readable, writable })` with multiple child processes or in-memory stream pairs
- `webSocketJsonTransport(socket)`
- custom `createTransport({ platform, codec })`
- `enableTransfer: false` with object-mode transport
- JSON codec rejects or documents non-JSON-safe values

Benchmarks should compare:

- `kkrpc/next` core-only
- `kkrpc/next/worker` object transport
- `kkrpc/next/websocket` JSON transport
- current `kkrpc/browser-mini`
- current `kkrpc/browser-lite`
- `comctx`

## Preview Decisions

The first `kkrpc/next` preview makes these decisions to keep scope implementable:

- `expose()` returns an `ExposedController` only. Bidirectional users should use `RPCChannel` directly.
- `wrap()` returns only the remote API proxy. `dispose(api)` releases the hidden channel through an
  internal `WeakMap`, so no public property is added to the proxy.
- Callback return values remain fire-and-forget, matching current kkrpc callback behavior.
- `jsonCodec()` is strict JSON for the first preview. It does not preserve `Uint8Array` compatibility
  from current `serialization-json.ts`; an extended JSON or SuperJSON codec can add that later.

## Recommended First Implementation Slice

The first implementation should be small enough to validate the architecture without recreating the
full current core:

1. Add `kkrpc/next` core with `RPCChannel`, `wrap`, `expose`, `Transport`, and compact protocol.
2. Add `kkrpc/next/worker` with object-mode worker presets.
3. Add `kkrpc/next/codecs` with `objectCodec`, `jsonCodec`, and `jsonLineCodec`.
4. Add `kkrpc/next/transport` with `createTransport`.
5. Add `kkrpc/next/stdio` with explicit `stdioJsonTransport({ readable, writable })` and one runtime
   shortcut for Node.
6. Add benchmarks for next core, next worker, next stdio/json, browser-mini, browser-lite, and comctx.

Defer Chrome extension, WebSocket, Deno, Bun, streaming, validation, middleware, and SuperJSON until
the core abstractions are proven.
