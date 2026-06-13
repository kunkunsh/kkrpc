# kkrpc

**Generated:** 2026-06-13

TypeScript-first RPC library — bidirectional, cross-runtime (Node.js, Deno, Bun, browsers, workers, Electron, Tauri, message buses).

## STRUCTURE

```
kkrpc/
├── packages/kkrpc/          # Core library
│   ├── src/
│   │   ├── core/            # RPCChannel, protocol, transport/codec primitives, plugins, transfer, remote-refs, streaming
│   │   ├── entries/         # 28 public entrypoint source files (mapped to exports in package.json)
│   │   ├── transports/      # 17 native transport factories
│   │   ├── features/        # Validation, middleware, SuperJSON plugins/codecs
│   │   └── relay.ts         # Bidirectional transport relay
│   ├── __tests__/           # Bun test suite (30+ test files)
│   ├── __deno_tests__/      # Deno regression tests
│   ├── scripts/             # test.ts, prepare.ts (Deno types), compare-browser-bundle-size.ts
│   ├── tsdown.config.ts     # Build config (28 entries, ESM+CJS, minified)
│   └── package.json         # 50+ export subpaths
└── packages/demo-api/       # Sample API implementation
```

## BUILD & TEST

```bash
pnpm install
pnpm --filter kkrpc build          # tsdown: 28 entries → dist/ (ESM + CJS, minified)
pnpm --filter kkrpc check-types    # tsc --noEmit
pnpm --filter kkrpc test           # deno test (__deno_tests__) → bun test (__tests__ --coverage)
pnpm format                        # prettier --write (tabs, 100 width, no semi, sorted imports)
pnpm lint                          # turbo lint
pnpm changeset                     # versioning
```

**CI order (`.github/workflows/ci.yml`):** build → check-types → test (`docker compose up` for Redis, RabbitMQ, Kafka, NATS).

**Env vars for integration tests:** `REDIS_URL=redis://localhost:6379`, `RABBITMQ_URL=amqp://admin:admin@localhost:5672`.

**Single-package focused:**
- `pnpm --filter kkrpc test` — all tests
- `pnpm --filter kkrpc check-types` — type check only
- `pnpm --filter "./examples/*" check-types` — example type checks

## KEY EXPORTS (50+ subpaths from `packages/kkrpc/package.json`)

| Subpath                  | Source entry                  | Purpose                              |
| ------------------------ | ----------------------------- | ------------------------------------ |
| `.`                      | `src/entries/mod.ts`          | Core: RPCChannel, wrap, expose, dispose, transfer, types |
| `./browser`              | `src/entries/browser-mod.ts`  | Browser-safe core entry              |
| `./deno`                 | `src/entries/deno-mod.ts`     | Deno-friendly core entry             |
| `./transport`            | `src/entries/transport.ts`    | Platform, Codec, createTransport()   |
| `./codecs`               | `src/entries/codecs.ts`       | objectCodec, jsonCodec, jsonLineCodec |
| `./plugins`              | `src/entries/plugins.ts`      | Plugin helper types                  |
| `./validation`           | `src/entries/validation.ts`   | defineMethod, defineAPI, validationPlugin, ValidatorMap, extractValidators, InferAPI |
| `./middleware`            | `src/entries/middleware.ts`   | middlewarePlugin                     |
| `./superjson`            | `src/entries/superjson.ts`    | superJsonCodec                       |
| `./remote-refs`          | `src/entries/remote-refs.ts`  | RemoteReferenceRPCChannel (Comlink-style proxy refs) |
| `./streaming`            | `src/entries/streaming.ts`    | StreamingRPCChannel (async iterable streaming) |
| `./worker`               | `src/entries/worker.ts`       | workerTransport, workerSelfTransport |
| `./stdio`                | `src/entries/stdio.ts`        | nodeStdioTransport, denoStdioTransport, bunStdioTransport, stdioPlatform |
| `./ws`                   | `src/entries/ws.ts`           | webSocketTransport                   |
| `./ws/hono`              | `src/entries/ws-hono.ts`      | webSocketHonoTransport               |
| `./ws/elysia`            | `src/entries/ws-elysia.ts`    | webSocketElysiaTransport             |
| `./http`                 | `src/entries/http.ts`         | httpClientTransport, createHttpHandler |
| `./iframe`               | `src/entries/iframe.ts`       | iframe transport                     |
| `./chrome-extension`     | `src/entries/chrome-extension.ts` | chromeExtensionTransport        |
| `./electron`             | `src/entries/electron.ts`     | electronIpcTransport, electronUtilityProcessTransport, electronUtilityProcessChildTransport, createSecureIpcBridge |
| `./tauri`                | `src/entries/tauri.ts`        | tauriTransport                       |
| `./socketio`             | `src/entries/socketio.ts`     | socketIoTransport                    |
| `./rabbitmq`             | `src/entries/rabbitmq.ts`     | rabbitMqTransport                    |
| `./kafka`                | `src/entries/kafka.ts`        | kafkaTransport                       |
| `./redis-streams`        | `src/entries/redis-streams.ts` | redisStreamsTransport              |
| `./nats`                 | `src/entries/nats.ts`         | natsTransport                        |
| `./relay`                | `src/entries/relay.ts`        | relayTransport                       |
| `./inspector`            | `src/entries/inspector.ts`    | Inspector (observability/plugin dev) |
| `./interop/*`            | `skills/`                     | Language interop agent skills        |

## KEY ARCHITECTURE

**Core flow:** `Platform<TWire>` + `Codec<TMessage, TWire>` → `createTransport()` → `Transport<RPCMessage>` → `RPCChannel`.

**Transport capability flags:** `objectMode`, `transfer`, `broadcast`, `remoteRefs`.

**Compact protocol:**
- Request: `{ t: "q", id, op, p, a?, v?, meta? }`
- Response: `{ t: "r", id, v?, e? }`
- Callback: `{ t: "cb", id, a }`
- Stream request: `{ t: "sq", id, sid, op, n?, v? }`
- Stream response: `{ t: "sr", id, sid, d?, v?, e? }`

**Plugin hooks (onion model):** `onRequest` → `wrapHandler` (around handler) → `onResponse` / `onError`.

**Bundle design:** Default `kkrpc` entry is intentionally small. Opt-in features live in subpaths: `./remote-refs`, `./streaming`, `./validation`, `./middleware`.

## KEY QUIRKS & GOTCHAS

- **Source entrypoints** are in `src/entries/`, not at root. Dist outputs go to `dist/`. **Do not edit `dist/`.**
- **Validation** uses Standard Schema v1 (Zod, Valibot, ArkType). Two modes: type-first (`ValidatorMap<API>`) and schema-first (`defineMethod()` + `extractValidators()`).
- **Transferables** use a `WeakMap<object, TransferDescriptor>` via `transfer()`. Only forwarded when both platform AND codec advertise `transfer: true`.
- **HTTP transport** is unary/request-only — no callbacks, no remote-refs, no streaming, no server-initiated calls.
- **Remote refs and streaming** are opt-in (`./remote-refs`, `./streaming`) — they add bundle weight.
- **Deno tests** use `--no-lock` flag to avoid updating `deno.lock`.
- **Smoke tests** run via `verify-package-export` in `posttest`/`postbuild`.
- **Message-bus transports** (RabbitMQ, Kafka, Redis Streams, NATS) use `BusEnvelope` for routing/filtering — they require Docker for tests.
- **Node.js 25** (`.node-version`), Bun, Deno v2.x required.
- **Import sorting** is handled by `@ianvs/prettier-plugin-sort-imports` (part of `pnpm format`).
- **Workers** support zero-copy transferables (`postMessage` with transfer list).

## CONVENTIONS

- Prettier: tabs, 100 width, no semicolons, trailing comma "none".
- Public types: PascalCase. Functions: camelCase. Files: kebab-case.
- No Node-specific imports from browser/worker entries.
- No type suppression comments or broad casts without justification.
