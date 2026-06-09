# next2main Native Migration Design

## Summary

The `next2main` branch is a breaking migration branch. It promotes the current vNext architecture into the stable `kkrpc` API, removes the classic `RPCChannel`/`IoInterface` architecture, and rewrites package exports, transports, tests, examples, docs, and skills to use native `Transport<RPCMessage>`-based APIs.

This branch must not preserve classic compatibility. If old behavior is needed, it remains available on `feat/next`, not in `next2main`.

## Approved Decisions

- The migration is a full breaking rewrite.
- Old classic code can be deleted instead of kept for compatibility.
- Package exports should still be split by environment and dependency boundary.
- The main `kkrpc` export should not import Node-only, browser-only, or optional peer dependency transports.
- Every existing transport family should be rewritten natively instead of being dropped.
- Tests and examples should continue to pass after migration.
- No `kkrpc/next` subpath should remain in package exports, examples, tests, docs, or skills.
- No migration bridges such as `classic-compat` or `next/io` should remain.

## Goals

- Make the current vNext core the stable `kkrpc` API.
- Keep the stable core small and browser-safe.
- Preserve tree-shaking by exposing optional features through subpaths.
- Rewrite all transport families as native `Transport<RPCMessage>` factories or handlers.
- Replace all examples and tests with stable imports and native transports.
- Remove old API names and docs that imply `IoInterface`, blocking `read()`/`write()`, or classic adapters.

## Non-Goals

- Do not maintain backward-compatible old imports in this branch.
- Do not keep old `*IO` classes as public aliases.
- Do not adapt old `IoInterface` instances through a bridge.
- Do not manually edit generated `dist/` or generated Typedoc output.

## Public API

The stable package API should replace the temporary `kkrpc/next` namespace.

| Public import | Purpose |
| --- | --- |
| `kkrpc` | Core API: `RPCChannel`, `wrap`, `expose`, `dispose`, `transfer`, protocol/transport/plugin core types |
| `kkrpc/transport` | `Transport`, `Platform`, `Codec`, `createTransport` |
| `kkrpc/codecs` | Built-in object, JSON, and JSON-line codecs |
| `kkrpc/plugins` | Core plugin hook types and helpers |
| `kkrpc/validation` | Native validation plugin APIs |
| `kkrpc/middleware` | Native middleware/interceptor plugin APIs |
| `kkrpc/superjson` | SuperJSON codecs only |
| `kkrpc/worker` | Worker transports |
| `kkrpc/stdio` | Node/Bun/Deno-style stdio transports |
| `kkrpc/http` | Native HTTP client/server transports and handlers |
| `kkrpc/websocket` | Native WebSocket transports |
| `kkrpc/iframe` | Native iframe `postMessage` transports |
| `kkrpc/chrome-extension` | Native Chrome extension port transports |
| `kkrpc/electron` | Native Electron utility process and IPC transports |
| `kkrpc/tauri` | Native Tauri shell stdio transport |
| `kkrpc/socketio` | Native Socket.IO transports |
| `kkrpc/rabbitmq` | Native RabbitMQ transport |
| `kkrpc/kafka` | Native Kafka transport |
| `kkrpc/redis-streams` | Native Redis Streams transport |
| `kkrpc/nats` | Native NATS transport |
| `kkrpc/inspector` | Inspector tooling updated to native RPC events/plugins |

The stable `kkrpc` main entry should stay browser-safe and feature-light. Runtime-specific or optional-peer code must live in subpaths.

## Source Layout

The temporary vNext implementation should become the formal source layout.

Recommended source layout:

| Current file | Stable role |
| --- | --- |
| `src/next/channel.ts` | `src/core/channel.ts` |
| `src/next/protocol.ts` | `src/core/protocol.ts` |
| `src/next/transport.ts` | `src/core/transport.ts` |
| `src/next/codecs.ts` | `src/core/codecs.ts` |
| `src/next/plugins.ts` | `src/core/plugins.ts` |
| `src/next/validation.ts` | `src/features/validation.ts` |
| `src/next/middleware.ts` | `src/features/middleware.ts` |
| `src/next/superjson.ts` | `src/features/superjson.ts` |
| `src/next/worker.ts` | `src/transports/worker.ts` |
| `src/next/stdio.ts` | `src/transports/stdio.ts` |

Entry wrappers should use stable names:

| Temporary entry | Stable entry |
| --- | --- |
| `next.ts` | `mod.ts` |
| `next-transport.ts` | `transport.ts` |
| `next-codecs.ts` | `codecs.ts` |
| `next-plugins.ts` | `plugins.ts` |
| `next-validation.ts` | `validation.ts` |
| `next-middleware.ts` | `middleware.ts` |
| `next-superjson.ts` | `superjson.ts` |
| `next-worker.ts` | `worker.ts` |
| `next-stdio.ts` | `stdio.ts` |

Files dedicated only to compatibility should be deleted:

- `next-classic-compat.ts`
- `next-io.ts`
- `src/next/classic-compat.ts`
- `src/next/io.ts`
- `src/interface.ts`
- classic `src/channel.ts`
- classic `src/adapters/*` implementations after native replacements exist

## Transport Design

Every transport should expose native `Transport<RPCMessage>` factories. Public names should prefer factory functions over classes and should avoid the old `IO` suffix.

### Worker, iframe, and Chrome extension

Worker and iframe transports should use object-mode messages when the platform supports structured clone. Transfer support should only be advertised when the platform can actually transfer values. Chrome extension ports should not claim transferable support unless verified.

### stdio, Node, Bun, Deno, and Tauri shell

Stdio-style transports should use newline-delimited JSON with `jsonLineCodec`. Parent-side transports should accept explicit readable/writable streams so multiple child processes can be managed at once. Child-side helpers can bind to process or runtime globals.

### HTTP

HTTP should be modeled as a request/response transport pair. The client transport sends one RPC request per HTTP request and emits the HTTP response back to the channel. The server handler receives an HTTP body, delivers it to a channel, waits for the matching response, and returns it as the HTTP response body.

### WebSocket, Hono, Elysia, and Socket.IO

Evented transports should subscribe to message events and send through the underlying socket. Framework-specific helpers should wrap the framework lifecycle and expose native transports without leaking framework internals into the core entry.

### Electron and Tauri

Electron IPC and utility process transports should be native evented transports. Tauri shell stdio should reuse the stdio transport shape while keeping Tauri dependencies behind `kkrpc/tauri` or browser-safe Tauri entry boundaries.

### RabbitMQ, Kafka, Redis Streams, and NATS

Message-bus transports need peer identity, routing metadata, or correlation filtering so multiple peers sharing a topic, queue, stream, or subject do not consume their own outbound messages accidentally. These transports should remain behind optional-peer subpaths.

### SuperJSON

SuperJSON should remain a codec feature, not a core dependency. It should only be imported from `kkrpc/superjson` or by callers that explicitly compose the codec into a transport.

## Examples

All examples should use stable imports.

Example import patterns:

```ts
import { expose, wrap } from "kkrpc"
import { httpClientTransport } from "kkrpc/http"
```

```ts
import { RPCChannel } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"
```

Examples with one-way APIs should prefer `wrap()` and `expose()`. Bidirectional examples should use `new RPCChannel(transport, { expose })` so both sides can expose and call APIs.

Current examples should be preserved where possible:

- Chrome extension
- Deno backend
- Deno Web Worker demo
- Electron demo
- HTTP demo
- iframe/worker demo
- inspector demo
- streaming middleware demo
- Tauri demo
- transferable browser demo

README manual testing sections should remain but use stable imports and native transport names.

## Tests

Classic tests should be deleted or rewritten. Current `next-*` tests should be renamed or merged into stable suites.

Test coverage should include:

- core RPC calls, properties, callbacks, constructors, errors, timeouts, and destroy behavior
- transfer markers on transports that support transfer
- validation plugin behavior
- middleware plugin behavior
- SuperJSON codec behavior
- Worker transports
- stdio transports across Node/Bun/Deno-compatible paths where feasible
- HTTP, WebSocket, Hono, Elysia, and Socket.IO transports
- iframe and Chrome extension transports where automation is available
- Electron and Tauri regressions used by examples
- RabbitMQ, Kafka, Redis Streams, and NATS integration tests with the existing service gating pattern

External service tests should remain gated by explicit environment variables or local service availability, matching existing project practice.

## Docs And Skills

Documentation should refer to the stable architecture rather than `next`.

- `NEXT_ARCHITECTURE.md` should become `ARCHITECTURE.md` or be replaced by stable architecture docs.
- `NEXT_MIGRATION.md` should be deleted or replaced by a breaking migration guide that states the old API was removed.
- Skills should use stable imports and native transport names.
- Generated docs under package output should not be edited manually.

## Old API Removal Gate

The final migration should include grep gates for old API remnants.

The following terms should not appear in runtime code, examples, tests, package exports, or skills unless they are in an intentional breaking migration note:

- `kkrpc/next`
- `next/io`
- `classic-compat`
- `IoInterface`
- `IoMessage`
- `RPCValidators`
- `RPCInterceptor`
- public class names ending in `IO` from the old adapter architecture

The old `*IO` names may appear in deleted-file history but should not remain in live source or examples.

## Rollout Plan

Implementation should proceed in verifiable slices:

1. Stable exports and core rename.
2. Worker and stdio transports.
3. HTTP, WebSocket, Hono, Elysia, and Socket.IO transports.
4. iframe, Chrome extension, and transferable browser transports.
5. Electron and Tauri transports.
6. RabbitMQ, Redis Streams, Kafka, and NATS transports.
7. Docs, examples, skills, and old-code cleanup gates.

Each slice should have focused tests before moving to the next slice.

## Verification

Final verification should include:

```bash
pnpm --filter kkrpc check-types
pnpm --filter kkrpc build
pnpm --filter kkrpc test
pnpm --filter kkrpc test:deno
pnpm --filter "./examples/*" check-types
pnpm --filter "./examples/*" build
```

Focused example tests and manual smoke tests should run where package scripts exist.

The final report should include any warnings that remain, especially Typedoc, Vite, Electron packaging, or external service test gating warnings.
