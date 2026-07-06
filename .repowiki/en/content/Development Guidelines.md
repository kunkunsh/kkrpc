# Development Guidelines

<cite>
**Referenced Files in This Document**
- [package.json](file://package.json)
- [packages/kkrpc/package.json](file://packages/kkrpc/package.json)
- [packages/kkrpc/tsdown.config.ts](file://packages/kkrpc/tsdown.config.ts)
- [packages/kkrpc/tsconfig.json](file://packages/kkrpc/tsconfig.json)
- [packages/kkrpc/deno.json](file://packages/kkrpc/deno.json)
- [packages/kkrpc/.editorconfig](file://packages/kkrpc/.editorconfig)
- [packages/kkrpc/src/AGENTS.md](file://packages/kkrpc/src/AGENTS.md)
- [packages/kkrpc/AGENTS.md](file://packages/kkrpc/AGENTS.md)
- [.github/workflows/ci.yml](file://.github/workflows/ci.yml)
- [packages/kkrpc/scripts/test.ts](file://packages/kkrpc/scripts/test.ts)
- [packages/kkrpc/__tests__/core.test.ts](file://packages/kkrpc/__tests__/core.test.ts)
</cite>

## Table of Contents

1. [Development Setup](#development-setup)
2. [Source Code Organization](#source-code-organization)
3. [Coding Conventions](#coding-conventions)
4. [Build and Test Commands](#build-and-test-commands)
5. [Testing Strategy](#testing-strategy)
6. [Adding a New Transport](#adding-a-new-transport)
7. [Continuous Integration](#continuous-integration)
8. [Versioning and Release](#versioning-and-release)

## Development Setup

### Prerequisites

- **Node.js** v25+ (see `.node-version`)
- **Bun** (primary test runner)
- **Deno** v2.x (for Deno regression tests)
- **pnpm** (package manager)

### Quick Start

```bash
# Install dependencies
pnpm install

# Build the core package
pnpm --filter kkrpc build

# Run type checks
pnpm --filter kkrpc check-types

# Run tests
pnpm --filter kkrpc test

# Format code
pnpm format
```

**Section sources**

- [package.json](file://package.json)
- [packages/kkrpc/package.json](file://packages/kkrpc/package.json#L38-L49)

## Source Code Organization

The package source is organized into four directories inside `src/`:

```
packages/kkrpc/src/
├── core/              # Stable runtime-agnostic core
│   ├── channel.ts     # RPCChannel class
│   ├── protocol.ts    # Compact message types
│   ├── transport.ts   # Transport/Platform/Codec primitives
│   ├── plugins.ts     # Plugin lifecycle hooks
│   ├── codecs.ts      # Built-in codecs
│   ├── transfer.ts    # Transfer descriptor helpers
│   ├── remote-ref.ts  # Shared remote-ref markers
│   ├── remote-ref-channel.ts  # RemoteReferenceRPCChannel
│   ├── streaming-channel.ts   # StreamingRPCChannel
│   ├── utils.ts       # Shared utilities
│   └── index.ts       # Convenience API (wrap, expose, dispose)
├── transports/        # Native transport factories
│   ├── stdio.ts       # stdin/stdout transports
│   ├── ws.ts          # WebSocket transports
│   ├── worker.ts      # Web Worker/MessagePort transports
│   ├── http.ts        # HTTP client/server transports
│   ├── iframe.ts      # iframe postMessage transport
│   ├── electron.ts    # Electron IPC transports
│   ├── kafka.ts       # Apache Kafka transport
│   ├── rabbitmq.ts    # RabbitMQ transport
│   ├── nats.ts        # NATS transport
│   ├── redis-streams.ts  # Redis Streams transport
│   ├── socketio.ts    # Socket.IO transport
│   ├── tauri.ts       # Tauri transport
│   ├── bus-envelope.ts    # Message bus envelope protocol
│   ├── chrome-extension.ts  # Chrome Extension transport
│   └── web-socket-client.ts  # WebSocket client helper
├── features/          # Optional feature plugins
│   ├── validation.ts  # Standard Schema validation
│   ├── middleware.ts   # Onion middleware interceptors
│   └── superjson.ts   # SuperJSON codecs
├── entries/           # Published entry point files
│   ├── mod.ts         # Main kkrpc entry
│   ├── browser-mod.ts # Browser-safe entry
│   ├── deno-mod.ts    # Deno entry
│   └── ...            # 28 total entry point files
└── relay.ts           # Transport relay helper
```

**Section sources**

- [packages/kkrpc/src/AGENTS.md](file://packages/kkrpc/src/AGENTS.md)
- [packages/kkrpc/AGENTS.md](file://packages/kkrpc/AGENTS.md)

## Coding Conventions

### Formatting

- **Tabs** for indentation (not spaces)
- **100 character** line width
- **No semicolons** (ASI style)
- **Trailing comma** set to `none`
- Format with Prettier: `pnpm format`

### TypeScript

- Public types are PascalCase: `RPCChannel`, `RPCPlugin`, `TransportCapabilities`
- Functions are camelCase: `wrap()`, `expose()`, `createTransport()`
- Files are kebab-case: `streaming-channel.ts`, `remote-ref.ts`, `bus-envelope.ts`
- No Node-specific imports from browser/worker entry files
- No type suppression comments or broad casts without justification
- TypeScript `strict` mode enabled in `tsconfig.json`

### Import Ordering

Imports are sorted by `@ianvs/prettier-plugin-sort-imports` (integrated into `pnpm format`):

1. Built-in modules
2. External dependencies
3. Internal modules (sorted by path depth)

### Documentation

- Each source file has a JSDoc `/**` block explaining its purpose
- Public exports have JSDoc with usage examples
- Internal helpers may have inline comments for complex logic
- AGENTS.md files at each directory level explain structure and conventions

**Section sources**

- [packages/kkrpc/tsconfig.json](file://packages/kkrpc/tsconfig.json)
- [packages/kkrpc/.editorconfig](file://packages/kkrpc/.editorconfig)
- [packages/kkrpc/src/AGENTS.md](file://packages/kkrpc/src/AGENTS.md)

## Build and Test Commands

```bash
# Build all packages
pnpm build

# Build only kkrpc
pnpm --filter kkrpc build

# Type checking
pnpm --filter kkrpc check-types

# Run tests (Bun)
pnpm --filter kkrpc test

# Run Deno regression tests
pnpm --filter kkrpc test:deno

# Format all files
pnpm format

# Lint
pnpm lint

# Watch mode for development
pnpm --filter kkrpc dev
```

**Section sources**

- [package.json](file://package.json)
- [packages/kkrpc/package.json](file://packages/kkrpc/package.json#L38-L49)

## Testing Strategy

### Bun Test Suite (`__tests__/`)

The primary test suite runs with Bun and covers:

| Test File                                 | What It Tests                                                  |
| ----------------------------------------- | -------------------------------------------------------------- |
| `core.test.ts`                            | RPCChannel basic operations, proxy, request/response, timeouts |
| `remote-refs.test.ts`                     | proxy(), releaseProxy(), remote object/function proxies        |
| `streaming.test.ts`                       | Async iterable streaming, flow control, cleanup                |
| `worker.test.ts`                          | Web Worker and MessagePort transports                          |
| `stdio.test.ts`                           | Stdio transport with JSON-line framing                         |
| `metadata.test.ts`                        | Message metadata propagation                                   |
| `transport-codecs.test.ts`                | Transport/Platform/Codec composition                           |
| `bus-envelope.test.ts`                    | Message bus envelope protocol                                  |
| `electron-tauri.test.ts`                  | Electron and Tauri transport tests                             |
| `superjson.test.ts`                       | SuperJSON codec tests                                          |
| `browser-boundary.test.ts`                | Browser environment boundary tests                             |
| `browser-bundle-benchmark-script.test.ts` | Bundle size benchmarks                                         |
| `package-exports.test.ts`                 | All subpath exports resolve correctly                          |
| `test-script.test.ts`                     | Build/test script integrity                                    |

### Deno Regression Suite (`__deno_tests__/`)

Deno-specific tests that verify compatibility across runtimes.

### Test Patterns

- Transports are tested with in-memory message channels or loopback adapters
- Remote-ref tests verify cross-channel proxy lifecycle
- Streaming tests verify flow control, cancellation, and error propagation
- The `verify-package-export` tool runs as a posttest/postbuild step

**Section sources**

- [packages/kkrpc/**tests**/](file://packages/kkrpc/__tests__/)
- [packages/kkrpc/scripts/test.ts](file://packages/kkrpc/scripts/test.ts)

## Adding a New Transport

To add a new transport factory:

1. **Create the transport file** in `src/transports/<name>.ts`

   - Implement `Transport<RPCMessage>` or compose from `Platform` + `Codec`
   - Declare appropriate capabilities
   - Export factory function(s)

2. **Create an entry file** in `src/entries/<name>.ts`

   - Re-export from the transport module
   - Add JSDoc with import examples

3. **Register in `package.json`**

   - Add subpath export under `exports`
   - Add peer dependency if the transport requires an external package

4. **Create tests** in `__tests__/<name>.test.ts`

   - Test basic RPC operations through the transport
   - Test edge cases (connection failures, reconnection, cleanup)

5. **Update `tsdown.config.ts`** if the entry file needs to be included in the build

6. **Add Deno type generation** in `scripts/prepare.ts` if needed

**Section sources**

- [packages/kkrpc/src/transports/stdio.ts](file://packages/kkrpc/src/transports/stdio.ts)
- [packages/kkrpc/src/entries/stdio.ts](file://packages/kkrpc/src/entries/stdio.ts)
- [packages/kkrpc/package.json](file://packages/kkrpc/package.json)
- [packages/kkrpc/tsdown.config.ts](file://packages/kkrpc/tsdown.config.ts)

## Continuous Integration

The CI pipeline (`.github/workflows/ci.yml`) runs in this order:

1. **Build** — `pnpm install && pnpm build`
2. **Type check** — `pnpm check-types`
3. **Test** — `docker compose up` for integration services (Redis, RabbitMQ, Kafka, NATS), then `pnpm test`

All branches run through the full pipeline. The `changeset` workflow handles version bumps and publishing.

**Section sources**

- [.github/workflows/ci.yml](file://.github/workflows/ci.yml)

## Versioning and Release

The project uses **Changesets** for version management:

```bash
pnpm changeset    # Create a new changeset
pnpm changeset version  # Apply changesets and bump versions
```

Version history:

- **v2.0.0** — Native transport architecture rewrite
- **v1.0.0** — First stable release
- **v0.x** — Experimental releases

Releases are published to both npm and JSR (jsr.io).

**Section sources**

- [packages/kkrpc/package.json](file://packages/kkrpc/package.json#L3)
