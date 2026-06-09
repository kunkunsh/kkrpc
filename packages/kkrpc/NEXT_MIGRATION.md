# kkrpc/next Migration Guide

`kkrpc/next` is the preferred path for new vNext examples and tests. Use native vNext APIs when a native vNext transport exists. Use compatibility helpers only for existing user code that needs an incremental migration.

## Decision Table

| Current code | Migration action |
| --- | --- |
| In-memory, Worker, or stdio transport | Migrate to native `kkrpc/next` now |
| Validation or middleware options | Use native plugins from `kkrpc/next/validation` or `kkrpc/next/middleware` |
| SuperJSON serialization | Use a native codec from `kkrpc/next/superjson` |
| Existing classic `validators` or `interceptors` options | Use `kkrpc/next/classic-compat` temporarily |
| Existing user-owned classic `IoInterface` adapter with no native next transport | Use `kkrpc/next/io` temporarily |
| Repo test/example for a classic-only adapter | Keep it classic or add a native vNext transport first |

## Native vNext Patterns

Use `wrap()` when the local side only calls a remote API:

```ts
import { wrap } from "kkrpc/next"

const api = wrap<RemoteAPI>(transport)
await api.ping()
```

Use `expose()` when the local side only exposes an API:

```ts
import { expose } from "kkrpc/next"

const controller = expose(localAPI, transport)
controller.dispose()
```

Use `RPCChannel` when both sides expose APIs or when the caller needs explicit channel ownership:

```ts
import { RPCChannel } from "kkrpc/next"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { expose: localAPI })
const remote = channel.getAPI()
```

## AI Migration Checklist

1. Identify the current entry point and transport.
2. Check whether a native vNext transport exists for that transport family.
3. If native exists, migrate to `wrap()`, `expose()`, or `RPCChannel` from `kkrpc/next`.
4. If native does not exist, do not rewrite repo examples/tests through a bridge just to make them look like vNext.
5. Use `classic-compat` only for old option names such as `validators` and `interceptors`.
6. Use `next/io` only for user-owned classic `IoInterface` adapters during migration.
7. Run the smallest focused test for the migrated file, then run `pnpm --filter kkrpc check-types`.

## Native Transport Availability

Native vNext transports currently available:

- Worker: `kkrpc/next/worker`
- stdio: `kkrpc/next/stdio`
- custom platforms/codecs: `kkrpc/next/transport` and `kkrpc/next/codecs`

Classic-only transport families should remain classic until a native vNext transport is added:

- HTTP and framework HTTP helpers
- WebSocket, Hono WebSocket, Elysia WebSocket, and Socket.IO
- iframe, Chrome extension, Electron, and Tauri adapters
- RabbitMQ, Redis Streams, Kafka, and NATS

## Compatibility Helpers

`kkrpc/next/classic-compat` translates classic-style options into native plugins:

```ts
import { wrapCompat } from "kkrpc/next/classic-compat"

const api = wrapCompat<RemoteAPI>(transport, {
	validators,
	interceptors
})
```

`kkrpc/next/io` adapts an existing classic `IoInterface` instance into a vNext transport:

```ts
import { RPCChannel } from "kkrpc/next"
import { ioTransport } from "kkrpc/next/io"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(ioTransport(classicIo), {
	expose: localAPI
})
```

Do not use either helper as the default pattern in new repo examples. Prefer native transports or keep the example classic until native transport support exists.
