# kkrpc - PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-09
**Branch:** next2main

## OVERVIEW

TypeScript-first RPC library with bidirectional communication across Node.js, Deno, Bun, browsers, workers, desktop runtimes, and message buses. The stable package uses a native `Transport<RPCMessage>` architecture with compact request/response/callback records, type-safe proxy APIs, plugins, and zero-copy transfer descriptors where supported.

## STRUCTURE

```
kkrpc/
├── packages/kkrpc/           # Core library
│   ├── src/
│   │   ├── core/             # RPCChannel, protocol, transport primitives, plugins, transfer
│   │   ├── transports/       # Native transport factories
│   │   ├── features/         # Validation, middleware, SuperJSON plugins/codecs
│   │   └── relay.ts          # Transport relay helper
│   ├── __tests__/            # Bun test suite
│   ├── __deno_tests__/       # Deno regression tests
│   ├── mod.ts                # Main stable entry
│   ├── browser-mod.ts        # Browser entry
│   └── dist/                 # Build output, do not edit
├── packages/demo-api/         # Sample API implementation
├── packages/slidev/           # Presentation slides
├── examples/                  # Usage examples
├── interop/                   # Go, Python, Rust, Swift interop
├── docs/                      # Documentation site
└── package.json               # pnpm workspace config
```

## WHERE TO LOOK

| Task                    | Location                         | Notes                                                                  |
| ----------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| Core RPC implementation | `packages/kkrpc/src/core/`       | `RPCChannel`, compact protocol, transport interface, plugins           |
| Native transports       | `packages/kkrpc/src/transports/` | stdio, HTTP, WebSocket, Worker, iframe, Electron, Tauri, message buses |
| Optional features       | `packages/kkrpc/src/features/`   | Validation, middleware, SuperJSON                                      |
| Relay support           | `packages/kkrpc/src/relay.ts`    | Bidirectional transport relay                                          |
| Test code               | `packages/kkrpc/__tests__/`      | Bun tests for stable entries and transports                            |
| Deno compatibility      | `packages/kkrpc/__deno_tests__/` | Deno regression tests                                                  |
| Usage examples          | `examples/`                      | HTTP, WebSocket, Worker, Chrome Extension, Electron, Tauri             |
| Language interop        | `interop/`                       | Go, Python, Rust, Swift compact JSON protocol implementations          |
| AI skills               | `skills/`                        | Agent skill docs                                                       |
| Build config            | `turbo.json`, `tsdown.config.ts` | Turbo and tsdown build system                                          |

## CODE MAP

| Symbol                       | Type      | Location                          | Role                                                   |
| ---------------------------- | --------- | --------------------------------- | ------------------------------------------------------ |
| `RPCChannel`                 | Class     | `src/core/channel.ts`             | Bidirectional RPC channel core                         |
| `wrap()`                     | Function  | `src/core/channel.ts`             | Create a remote API proxy                              |
| `expose()`                   | Function  | `src/core/channel.ts`             | Expose a local API on a transport                      |
| `RPCMessage`                 | Type      | `src/core/protocol.ts`            | Compact protocol union                                 |
| `Transport`                  | Interface | `src/core/transport.ts`           | Stable transport abstraction                           |
| `transfer()`                 | Function  | `src/core/transfer.ts`            | Mark values and transferables for zero-copy transports |
| `validationPlugin()`         | Function  | `src/features/validation.ts`      | Standard Schema validation plugin                      |
| `middlewarePlugin()`         | Function  | `src/features/middleware.ts`      | Request/response middleware plugin                     |
| `superJsonCodec()`           | Function  | `src/features/superjson.ts`       | SuperJSON codec for stable transports                  |
| `nodeStdioTransport()`       | Function  | `src/transports/stdio.ts`         | Node stdio transport                                   |
| `denoStdioTransport()`       | Function  | `src/transports/stdio.ts`         | Deno stdio transport                                   |
| `bunStdioTransport()`        | Function  | `src/transports/stdio.ts`         | Bun stdio transport                                    |
| `webSocketTransport()`       | Function  | `src/transports/ws.ts`            | Existing socket transport wrapper                      |
| `webSocketClientTransport()` | Function  | `src/transports/ws.ts`            | Client WebSocket factory                               |
| `workerTransport()`          | Function  | `src/transports/worker.ts`        | Main-thread worker transport                           |
| `workerSelfTransport()`      | Function  | `src/transports/worker.ts`        | Worker-global transport                                |
| `electronIpcTransport()`     | Function  | `src/transports/electron.ts`      | Electron IPC endpoint transport                        |
| `rabbitMqTransport()`        | Function  | `src/transports/rabbitmq.ts`      | RabbitMQ transport                                     |
| `kafkaTransport()`           | Function  | `src/transports/kafka.ts`         | Kafka transport                                        |
| `redisStreamsTransport()`    | Function  | `src/transports/redis-streams.ts` | Redis Streams transport                                |
| `natsTransport()`            | Function  | `src/transports/nats.ts`          | NATS transport                                         |

## CONVENTIONS

### Code Style

- TypeScript files use kebab-case where practical.
- Public classes/interfaces use PascalCase; functions use camelCase.
- Prettier uses tabs, 100 character width, no semicolons, and sorted imports.
- Keep comments succinct and explain non-obvious behavior only.

### Module Organization

- Core protocol/channel code belongs in `packages/kkrpc/src/core/`.
- Runtime communication helpers belong in `packages/kkrpc/src/transports/`.
- Optional validation/middleware/codec features belong in `packages/kkrpc/src/features/`.
- Tests live in `packages/kkrpc/__tests__/` and should use real transports where feasible.

### Build System

- pnpm workspaces manage packages.
- Turbo coordinates common scripts.
- tsdown builds ESM/CJS outputs.
- Typedoc output is generated and should not be edited manually.
- Changesets handle versioning.

### Testing Strategy

- Primary tests: `pnpm --filter kkrpc test`.
- Type checks: `pnpm --filter kkrpc check-types`.
- Deno regressions are included in the package test script.
- Interop suites live under `interop/go`, `interop/python`, `interop/rust`, and `interop/swift`.
- Prefer real client/server setups over mocks.

## ANTI-PATTERNS

- Do not edit `dist/` or generated Typedoc output.
- Do not use type suppression comments or broad casts unless explicitly justified.
- Do not import Node-specific modules from browser entry points.
- Do not add compatibility bridges for removed public APIs unless the task explicitly requires one.

## UNIQUE STYLES

### Multi-Entry Point Strategy

Stable package exports include core and feature-specific entry points:

- `.` for core RPC APIs
- `./browser`, `./deno`, `./transport`, `./codecs`, `./plugins`
- `./worker`, `./stdio`, `./http`, `./ws`, `./ws/hono`, `./ws/elysia`
- `./iframe`, `./chrome-extension`, `./electron`, `./tauri`
- `./socketio`, `./rabbitmq`, `./kafka`, `./redis-streams`, `./nats`
- `./validation`, `./middleware`, `./superjson`, `./relay`, `./inspector`

### Transport Capabilities

Each native transport can declare capabilities such as object mode, transferable support, or broadcast behavior:

```text
capabilities: {
	objectMode: true,
	transfer: true
}
```

### Compact Protocol

Stable messages are compact JSON-compatible records:

- Request: `{ t: "q", id, op, p, a?, v? }`
- Response: `{ t: "r", id, v?, e? }`
- Callback: `{ t: "cb", id, a }`

## COMMANDS

```bash
pnpm install
pnpm dev
pnpm build
pnpm --filter kkrpc check-types
pnpm --filter kkrpc test
pnpm --filter "./examples/*" check-types
pnpm lint
pnpm format
pnpm changeset
```

## NOTES

### Cross-Runtime Compatibility

- stdio: Node.js, Deno, Bun inter-process communication.
- Workers: browser and Deno worker APIs.
- HTTP/WebSocket: browser and server runtimes.
- Message buses: RabbitMQ, Redis Streams, Kafka, NATS.
- Desktop: Electron and Tauri helpers.

### Data Validation

- Standard Schema compatible with Zod, Valibot, and ArkType.
- Use `defineMethod()` and `defineAPI()` for schema-first APIs.
- Use `validationPlugin()` to validate stable channel calls.

### Transferable Object Performance

- Large browser transfers can use zero-copy ownership moves.
- Supported types depend on the host runtime and transport.
- Non-transferable transports fall back to regular serialization.

### Browser Import

```text
import { RPCChannel } from "kkrpc/browser"
import { workerTransport } from "kkrpc/worker"
```
