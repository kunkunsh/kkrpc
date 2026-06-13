---
name: kkrpc-migration
description: Use when migrating kkrpc projects across breaking stable API changes, replacing classic IoInterface/*IO adapters, next entries, validation/interceptor options, transport imports, or opt-in streaming/remote-reference entries.
version: 1.0.0
license: MIT
metadata:
  author: kkrpc
  domain: typescript-rpc
  tags:
    - rpc
    - migration
    - typescript
    - kkrpc
    - transport
compatibility: Migrates kkrpc 0.7.x and temporary vNext code to kkrpc 1.0 stable APIs.
---

# kkrpc 1.0 Migration

Use this skill to migrate applications from kkrpc 0.7.x or temporary `kkrpc/next` APIs to the stable 1.0 API.

The 1.0 public API is native `Transport<RPCMessage>` based. Do not preserve the classic `IoInterface` adapter model, public `*IO` classes, `classic-compat`, `next/io`, `browser-lite`, `browser-mini`, or `electron-ipc` imports.

Canonical user documentation: `docs/src/content/docs/guides/migration-1-0.md`.
For the slim-core feature split, also check `docs/src/content/docs/guides/migration-0-1-to-0-2.md`.

## Migration Workflow

1. Inspect package versions and imports.
2. Search for old API usage.
3. Replace package entries and transport imports.
4. Replace channel setup with `wrap()`, `expose()`, or native `RPCChannel`.
5. Replace classic IO adapters with native transport factories.
6. Replace validation and middleware options with plugins.
7. Move SuperJSON to explicit codec composition.
8. Run type checks, tests, and old-API searches.

## Search Patterns

Run these searches before editing and again before finishing:

```bash
rg 'kkrpc/next|next/io|classic-compat|IoInterface|IoMessage|RPCValidators|kkrpc/browser-lite|kkrpc/browser-mini|kkrpc/electron-ipc'
rg '[A-Za-z0-9_]+IO\b'
rg 'validators\s*:|interceptors\s*:'
```

The `*IO` search may find application names. Review matches manually and only migrate kkrpc classic adapter usage.

## Entry Mapping

| Old import | New import |
| --- | --- |
| `kkrpc/next` | `kkrpc` |
| `kkrpc/next/transport` | `kkrpc/transport` |
| `kkrpc/next/codecs` | `kkrpc/codecs` |
| `kkrpc/next/plugins` | `kkrpc/plugins` |
| `kkrpc/next/validation` | `kkrpc/validation` |
| `kkrpc/next/middleware` | `kkrpc/middleware` |
| `kkrpc/next/superjson` | `kkrpc/superjson` |
| async iterable APIs from `kkrpc` | `kkrpc/streaming` |
| callback-return/object-handle APIs from `kkrpc` | `kkrpc/remote-refs` |
| `kkrpc/next/worker` | `kkrpc/worker` |
| `kkrpc/next/stdio` | `kkrpc/stdio` |
| `kkrpc/browser-lite` | `kkrpc` or `kkrpc/browser` |
| `kkrpc/browser-mini` | `kkrpc` or `kkrpc/browser` |
| `kkrpc/electron-ipc` | `kkrpc/electron` |

Runtime transports must not be imported from the main `kkrpc` entry. Use explicit subpaths.

Async iterable streaming and request/response remote references must also use explicit subpaths. The default `kkrpc` entry is the slim request/response core.

## Core API Patterns

### Client-only proxy

Use `wrap()` when this side only calls a remote API.

```typescript
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"

const api = wrap<RemoteAPI>(webSocketClientTransport({ url: "ws://localhost:3000" }))
```

If the proxy has a bounded lifetime, dispose it explicitly:

```typescript
import { dispose } from "kkrpc"

dispose(api)
```

### Server-only API

Use `expose()` when this side only publishes a local API.

```typescript
import { expose } from "kkrpc"

const controller = expose(localAPI, transport)
controller.dispose()
```

### Bidirectional endpoint

Use native `RPCChannel` when both sides expose APIs.

```typescript
import { RPCChannel } from "kkrpc"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { expose: localAPI })
const remote = channel.getAPI()
channel.destroy()
```

The generic order is local API first, remote API second.

## Transport Mapping

| Boundary | Native 1.0 helper |
| --- | --- |
| Web Worker parent | `workerTransport()` from `kkrpc/worker` |
| Web Worker global | `workerSelfTransport()` from `kkrpc/worker` |
| Node stdio | `nodeStdioTransport()` from `kkrpc/stdio` |
| Generic stdio JSON | `stdioJsonTransport()` from `kkrpc/stdio` |
| HTTP client | `httpClientTransport()` from `kkrpc/http` |
| HTTP server | `createHttpHandler()` from `kkrpc/http` |
| WebSocket socket | `webSocketTransport()` from `kkrpc/ws` |
| WebSocket client | `webSocketClientTransport()` from `kkrpc/ws` |
| Hono WebSocket | `createHonoWebSocketHandler()` or `honoWebSocketTransport()` from `kkrpc/ws/hono` |
| Elysia WebSocket | `createElysiaWebSocketHandler()` or `elysiaWebSocketTransport()` from `kkrpc/ws/elysia` |
| iframe parent | `iframeParentTransport()` from `kkrpc/iframe` |
| iframe child | `iframeChildTransport()` from `kkrpc/iframe` |
| Chrome extension port | `chromePortTransport()` from `kkrpc/chrome-extension` |
| Electron IPC | `electronIpcTransport()` from `kkrpc/electron` |
| Electron utility process | `electronUtilityProcessTransport()` or `electronUtilityProcessChildTransport()` from `kkrpc/electron` |
| Tauri shell child process | `tauriShellStdioTransport()` from `kkrpc/tauri` |
| Socket.IO | `socketIoTransport()` from `kkrpc/socketio` |
| RabbitMQ | `rabbitMqTransport()` from `kkrpc/rabbitmq` |
| Kafka | `kafkaTransport()` from `kkrpc/kafka` |
| Redis Streams | `redisStreamsTransport()` from `kkrpc/redis-streams` |
| NATS | `natsTransport()` from `kkrpc/nats` |

## HTTP Guardrail

HTTP is unary request/response in 1.0. Do not migrate callback-heavy, subscription, streaming-progress, remote-reference, or server-push code to `kkrpc/http`. Use WebSocket or another evented transport for those boundaries.

## Validation Migration

Replace classic `validators` options with `validationPlugin()`.

```typescript
import { expose } from "kkrpc"
import { validationPlugin } from "kkrpc/validation"

const validators = {
	"math.add": {
		input: argsSchema,
		output: resultSchema
	}
}

expose(api, transport, {
	plugins: [validationPlugin(validators)]
})
```

If preserving an existing validator map is simpler, pass that map to `validationPlugin()` instead of rewriting the API around `defineMethod()`.

## Middleware Migration

Replace classic `interceptors` options with `middlewarePlugin()`.

```typescript
import { middlewarePlugin, type RPCInterceptor } from "kkrpc/middleware"

const logger: RPCInterceptor = async (ctx, next) => {
	console.log(ctx.method)
	return next()
}

const plugins = [middlewarePlugin([logger])]
```

Install the plugin through `wrap()`, `expose()`, or `RPCChannel` options.

## SuperJSON Migration

SuperJSON is not a core import. Use `kkrpc/superjson` only where a transport needs richer value encoding.

```typescript
import { createTransport } from "kkrpc/transport"
import { superJsonCodec } from "kkrpc/superjson"

const transport = createTransport({ platform, codec: superJsonCodec() })
```

## Transferables

Use `transfer()` from `kkrpc` only for transports that support transferable ownership, such as Web Workers.

```typescript
import { transfer } from "kkrpc"

await api.process(transfer(buffer, [buffer]))
```

Do not assume transfer support for HTTP, stdio, or message-bus transports.

## Guardrails

- Do not add backward compatibility aliases for removed public APIs.
- Do not reintroduce `IoInterface`, `IoMessage`, or public `*IO` classes.
- Do not import runtime-specific transports from `kkrpc`.
- Do not pull optional peers into browser-safe entries.
- Do not claim HTTP supports callbacks or bidirectional calls.
- Do not leave async iterable APIs on the default `kkrpc` entry; use `kkrpc/streaming`.
- Do not leave callback-return or object-handle APIs on the default `kkrpc` entry; use `kkrpc/remote-refs` and explicit `proxy(value)` markers.
- Do not edit generated `dist` or Typedoc output while migrating this repository.

## Verification

For this repository, run:

```bash
pnpm --filter kkrpc check-types
pnpm --filter kkrpc test
pnpm --filter "./examples/*" check-types
```

For downstream projects, run the project type check, unit tests, and at least one integration test for each migrated transport boundary.

Before declaring migration complete, re-run the old API searches and verify that remaining matches are documentation, intentional compatibility notes, or unrelated false positives.
