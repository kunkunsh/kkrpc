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
| `kkrpc/browser` | Browser-safe convenience entry for core plus browser transports |
| `kkrpc/deno` | Deno-safe convenience entry for core plus Deno transports |
| `kkrpc/worker` | Worker transports |
| `kkrpc/stdio` | Node/Bun/Deno-style stdio transports |
| `kkrpc/http` | Native HTTP client/server transports and handlers |
| `kkrpc/ws` | Native WebSocket transports |
| `kkrpc/ws/hono` | Native Hono WebSocket integration |
| `kkrpc/ws/elysia` | Native Elysia WebSocket integration |
| `kkrpc/iframe` | Native iframe `postMessage` transports |
| `kkrpc/chrome-extension` | Native Chrome extension port transports |
| `kkrpc/electron` | Native Electron utility process and IPC transports |
| `kkrpc/tauri` | Native Tauri shell stdio transport |
| `kkrpc/socketio` | Native Socket.IO transports |
| `kkrpc/rabbitmq` | Native RabbitMQ transport |
| `kkrpc/kafka` | Native Kafka transport |
| `kkrpc/redis-streams` | Native Redis Streams transport |
| `kkrpc/nats` | Native NATS transport |
| `kkrpc/relay` | Native transport-to-transport relay helper |
| `kkrpc/inspector` | Inspector tooling updated to native RPC events/plugins |

The stable `kkrpc` main entry should stay browser-safe and feature-light. Runtime-specific or optional-peer code must live in subpaths.

Existing export decisions:

| Existing export | Decision |
| --- | --- |
| `kkrpc/browser` | Keep and rewrite as a native browser-safe entry. It may re-export core, Worker, iframe, browser WebSocket client, Chrome extension, and transferable helpers, but must not import Node-only or optional peer code. |
| `kkrpc/browser-lite` | Remove. The stable core replaces this size-optimization experiment. |
| `kkrpc/browser-mini` | Remove. The stable core replaces this size-optimization experiment. |
| `kkrpc/deno` | Keep and rewrite as a native Deno-safe entry. It may re-export core plus Deno stdio/worker helpers. |
| `kkrpc/electron-ipc` | Remove as a public subpath. IPC and utility-process transports live under `kkrpc/electron`. |
| Hono helpers | Keep under `kkrpc/ws/hono`, not in `kkrpc` or `kkrpc/http`. |
| Elysia helpers | Keep under `kkrpc/ws/elysia`, not in `kkrpc` or `kkrpc/http`. |

## Source Layout

The temporary vNext implementation should become the formal source layout.

Recommended source layout:

| Current file | Stable role |
| --- | --- |
| `src/next/channel.ts` | `src/core/channel.ts` |
| `src/next/index.ts` | `src/core/index.ts` |
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

`mod.ts` should export from `src/core/index.ts`. That core index owns the stable `wrap()`, `expose()`, and `dispose()` helpers.

Files dedicated only to compatibility should be deleted:

- `next-classic-compat.ts`
- `next-io.ts`
- `src/next/classic-compat.ts`
- `src/next/io.ts`
- `src/interface.ts`
- classic `src/channel.ts`
- classic `src/adapters/*` implementations after native replacements exist

Shared classic-era files should be handled explicitly:

| Existing file | Decision |
| --- | --- |
| `src/transfer.ts` | Keep the transferable marker, move it into `src/core/transfer.ts`, and export it from `kkrpc`. |
| `src/utils.ts` | Move only still-used utilities, such as ID generation, into `src/core`. Delete unused classic helpers. |
| `src/serialization.ts` | Delete or replace with native codecs. It must not remain as a classic wire serializer. |
| `src/standard-schema.ts` | Keep only the parts required by native validation and place them under `src/features/validation.ts` or a feature-local helper. |
| `src/relay.ts` | Rewrite as a native transport relay and export through `kkrpc/relay`. |
| `src/transfer-handlers.ts` | Delete unless custom transfer handlers are redesigned as a native core feature with tests. |

## Transport Design

Every transport should expose native `Transport<RPCMessage>` factories. Public names should prefer factory functions over classes and should avoid the old `IO` suffix.

### Worker, iframe, and Chrome extension

Worker and iframe transports should use object-mode messages when the platform supports structured clone. Transfer support should only be advertised when the platform can actually transfer values. Chrome extension ports should not claim transferable support unless verified.

### stdio, Node, Bun, Deno, and Tauri shell

Stdio-style transports should use newline-delimited JSON with `jsonLineCodec`. Parent-side transports should accept explicit readable/writable streams so multiple child processes can be managed at once. Child-side helpers can bind to process or runtime globals.

### HTTP

Unary HTTP should be modeled as client-request-only RPC. It supports client-initiated calls that produce one response. It must not imply full bidirectional RPC, server-initiated calls, or callback invocation over out-of-band messages. Examples that need callbacks, server pushes, or bidirectional calls should use WebSocket or another evented transport.

The HTTP client transport sends only request messages (`t: "q"`). Each `send()` creates one HTTP request, waits for one response body, and emits that response to subscribers. Sending a response or callback message through the HTTP client transport is a misuse and should reject with a transport error.

The HTTP server API should be handler-oriented rather than a long-lived bidirectional transport. A helper such as `createHttpHandler(api, options)` should create a request-scoped channel or dispatcher per HTTP request, deliver the decoded request, wait for exactly one response with the matching RPC id, and close the request-scoped resources after the response or timeout.

HTTP error behavior should be explicit:

| Situation | Behavior |
| --- | --- |
| Exposed API throws | Return a valid RPC error response for the request id. |
| Malformed request body or invalid RPC message | Return HTTP 400. |
| Handler timeout after a valid request id is known | Return HTTP 504, preferably with an RPC error response body carrying that id. |
| Network or non-2xx response on the client | Reject the client transport `send()` and let the channel reject the pending call. |
| Handler closes | Reject new requests and dispose request-scoped listeners. |

### WebSocket, Hono, Elysia, and Socket.IO

Evented transports should subscribe to message events and send through the underlying socket. `kkrpc/ws` owns plain WebSocket transports. `kkrpc/ws/hono` and `kkrpc/ws/elysia` own framework lifecycle helpers. `kkrpc/socketio` remains separate because it uses Socket.IO-specific peers and semantics rather than the WebSocket object model.

### Electron and Tauri

Electron IPC and utility process transports should be native evented transports. Tauri shell stdio should reuse the stdio transport shape while keeping Tauri dependencies behind `kkrpc/tauri` or browser-safe Tauri entry boundaries.

### RabbitMQ, Kafka, Redis Streams, and NATS

Message-bus transports need peer identity, routing metadata, or correlation filtering so multiple peers sharing a topic, queue, stream, or subject do not consume their own outbound messages accidentally. These transports should remain behind optional-peer subpaths.

All message-bus transports should use a common internal envelope around `RPCMessage`:

```ts
interface BusEnvelope {
	protocol: "kkrpc.bus.v1"
	transportId: string
	from: string
	to?: string
	correlationId?: string
	sequence?: number
	sentAt?: number
	message: RPCMessage
}
```

Routing requirements:

- Each transport instance has a stable local peer id.
- Direct peer-to-peer transports should set `to` to the remote peer id and ignore envelopes addressed to other peers.
- Transports should ignore their own envelopes by default when `from` matches the local peer id.
- `correlationId` should mirror the RPC message id when available so broker diagnostics can group request/response traffic without changing the core protocol.
- Ordering is best-effort unless the underlying broker partition, stream, or subject guarantees stronger ordering for the chosen key.
- Duplicate delivery is possible on at-least-once brokers, so handlers should not claim exactly-once semantics.

Ack and commit behavior should be platform-specific but consistent:

| Transport | Ack/commit rule |
| --- | --- |
| RabbitMQ | Ack after the envelope is decoded, passes routing filters, and is delivered to local subscribers. Nack malformed envelopes without requeue by default to avoid poison loops. |
| Redis Streams | XACK after successful local delivery. Pending-entry recovery is an operational concern and should be documented if supported. |
| Kafka | Commit offsets after successful local delivery when manual commit is enabled; otherwise document reliance on the client auto-commit setting. |
| NATS | Ack after successful local delivery for JetStream-style consumers; plain pub/sub has no ack. |

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

Export-boundary tests should be added or updated so package verification catches stale classic paths. At minimum, tests should assert that removed exports are absent and stable exports resolve:

| Export | Expected |
| --- | --- |
| `kkrpc` | resolves to native core only |
| `kkrpc/browser` | resolves and does not import Node-only modules |
| `kkrpc/deno` | resolves in Deno tests |
| `kkrpc/browser-lite` | removed |
| `kkrpc/browser-mini` | removed |
| `kkrpc/next` | removed |
| `kkrpc/next/*` | removed |
| `kkrpc/electron-ipc` | removed |
| `kkrpc/ws/hono` | resolves behind Hono peer dependency boundary |
| `kkrpc/ws/elysia` | resolves behind Elysia peer dependency boundary |

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

Final cleanup commands should be explicit. These commands are expected to produce no matches outside allowed migration/spec documents. The only allowed live documents for old terms are this design spec, superpowers implementation plans, and `packages/kkrpc/BREAKING_MIGRATION.md` if that file is created during docs cleanup.

```bash
rg 'kkrpc/next|next/io|classic-compat|IoInterface|IoMessage|RPCValidators|RPCInterceptor' packages examples skills docs \
	--glob '!docs/superpowers/specs/2026-06-09-next2main-native-migration-design.md' \
	--glob '!docs/superpowers/plans/**' \
	--glob '!packages/kkrpc/BREAKING_MIGRATION.md' \
	--glob '!**/dist/**'
```

```bash
rg 'export class [A-Za-z0-9_]+IO\b|class [A-Za-z0-9_]+IO\b|import \{[^}]*[A-Za-z0-9_]+IO\b' packages examples skills \
	--glob '!**/dist/**'
```

Removed export checks should also be explicit:

```bash
rg '"\./next|"\./browser-lite"|"\./browser-mini"|"\./electron-ipc"' packages/kkrpc/package.json
```

The removed export command should return no matches after migration.

Browser-safety gates should verify that stable browser-safe entries do not pull Node-only or optional-peer dependencies into browser bundles:

- Add or update a browser import smoke test that bundles `kkrpc` and `kkrpc/browser` for the browser platform.
- The smoke test should fail if Node built-ins, `process`, or optional peers such as `ws`, `hono`, `elysia`, `socket.io`, `amqplib`, `kafkajs`, `ioredis`, `@nats-io/transport-node`, or `@tauri-apps/plugin-shell` are pulled into the main or browser entries.
- Update existing browser bundle comparison scripts to measure stable `kkrpc`, `kkrpc/browser`, and optional stable subpaths. Remove `browser-lite`, `browser-mini`, and `kkrpc/next` benchmark entries.

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

Package export verification and browser-safety verification should also run:

```bash
pnpm --filter kkrpc exec verify-package-export verify
pnpm --filter kkrpc compare:browser-bundle-size
```

If the bundle-size command is renamed during migration, the replacement command must measure the stable main/browser entries and optional feature entries.

The final report should include any warnings that remain, especially Typedoc, Vite, Electron packaging, or external service test gating warnings.
