# kkrpc - PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-06
**Commit:** (current)
**Branch:** main

## OVERVIEW

TypeScript-first RPC library with bidirectional communication across Node.js, Deno, Bun, Browser, and Tauri. Supports 15+ transport protocols with full type safety and zero-copy transferable objects. Includes language interop for Go, Python, Rust, and Swift.

## STRUCTURE

```
kkrpc/
├── packages/kkrpc/           # Core library
│   ├── src/                  # Source code
│   │   ├── channel.ts         # RPCChannel core
│   │   ├── interface.ts       # IoInterface abstraction
│   │   ├── adapters/         # Transport adapters (22 adapters)
│   │   ├── transfer*.ts       # Transferable objects support
│   │   └── serialization.ts  # JSON/superjson serialization
│   ├── __tests__/            # Bun test suite (17+ tests)
│   ├── __deno_tests__/       # Deno regression tests
│   ├── mod.ts                # Main entry (Node/Deno/Bun)
│   ├── browser-mod.ts        # Browser entry
│   └── dist/                 # Build output (do not edit)
├── packages/demo-api/         # Sample API implementation
├── packages/slidev/           # Presentation slides
├── examples/                  # 10+ usage examples
├── interop/                   # Language interop (Go, Python, Rust, Swift)
├── docs/                      # Documentation site
└── package.json               # pnpm workspace config
```

## WHERE TO LOOK

| Task                | Location                           | Notes                                      |
| ------------------- | ---------------------------------- | ------------------------------------------ |
| Core implementation | `packages/kkrpc/src/`              | channel.ts, interface.ts, serialization.ts |
| Transport adapters  | `packages/kkrpc/src/adapters/`     | 22 transport protocol adapters             |
| Validation          | `packages/kkrpc/src/validation.ts` | Standard Schema runtime validation         |
| Test code           | `packages/kkrpc/__tests__/`        | Bun tests, covers all adapters             |
| Deno compatibility  | `packages/kkrpc/__deno_tests__/`   | Deno regression tests                      |
| Usage examples      | `examples/`                        | HTTP, WebSocket, Worker, Chrome Extension  |
| AI skills           | `skills/`                          | Claude Code SKILL.md files                 |
| Build config        | `turbo.json`, `tsdown.config.ts`   | Turbo + tsdown build system                |

## CODE MAP

| Symbol                        | Type      | Location                          | Role                                  |
| ----------------------------- | --------- | --------------------------------- | ------------------------------------- |
| RPCChannel                    | Class     | src/channel.ts                    | Bidirectional RPC channel core        |
| IoInterface                   | Interface | src/interface.ts                  | Transport layer abstraction interface |
| IoCapabilities                | Interface | src/interface.ts                  | Adapter capability declarations       |
| serialize/deserialize         | Function  | src/serialization.ts              | Message serialization                 |
| transfer()                    | Function  | src/transfer.ts                   | Mark zero-copy objects                |
| RPCValidationError            | Class     | src/validation.ts                 | Validation error with context         |
| defineMethod()                | Function  | src/validation.ts                 | Schema-first method definition        |
| defineAPI()                   | Function  | src/validation.ts                 | Schema-first API definition           |
| extractValidators()           | Function  | src/validation.ts                 | Extract validators from defined API   |
| NodeIo                        | Class     | adapters/node.ts                  | Node.js stdio                         |
| DenoIo                        | Class     | adapters/deno.ts                  | Deno stdio                            |
| BunIo                         | Class     | adapters/bun.ts                   | Bun stdio                             |
| WorkerParentIO                | Class     | adapters/worker.ts                | Web Worker parent side                |
| WorkerChildIO                 | Class     | adapters/worker.ts                | Web Worker child side                 |
| TauriShellStdio               | Class     | adapters/tauri.ts                 | Tauri shell plugin adapter            |
| ElectronIpcMainIO             | Class     | adapters/electron-ipc-main.ts     | Electron main IPC                     |
| ElectronIpcRendererIO         | Class     | adapters/electron-ipc-renderer.ts | Electron renderer IPC                 |
| ElectronUtilityProcessIO      | Class     | adapters/electron.ts              | Electron utility process (main)       |
| ElectronUtilityProcessChildIO | Class     | adapters/electron-child.ts        | Electron utility process (child)      |

## CONVENTIONS

### Code Style

- **File naming**: TypeScript files use kebab-case (e.g. `stdio-rpc.ts`)
- **Export naming**: Classes/interfaces use PascalCase (`RPCChannel`), functions use camelCase (`generateUUID`)
- **Comment style**: Chinglish/mixed - English terminology with Chinese explanations
- **Formatting**: Prettier config: tabs, 100 char width, no semicolons, auto-sort imports

### Module Organization

- Shared types in `packages/kkrpc/src/*.ts`
- Adapter helper code in `src/adapters/<transport>/`
- Test fixtures in `__tests__/fixtures/`
- Test scripts in `__tests__/scripts/`

### Build System

- **pnpm workspaces**: Manage multi-package project
- **Turbo**: Unified build pipeline (`pnpm dev/build/test`)
- **tsdown**: TypeScript to ES module build (ESM + CJS dual output)
- **Typedoc**: API documentation generation to `docs/`
- **Changesets**: Version management and changelog generation

### Testing Strategy

- **Primary tests**: Bun test runner (`bun test __tests__ --coverage`)
- **Cross-runtime**: Deno regression tests (`deno test -R __deno_tests__`)
- **No mocks**: Real client/server setups, no mocking
- **Bidirectional testing**: Both sides expose and consume APIs
- **Stress testing**: High-concurrency operations (5000+ calls)

## ANTI-PATTERNS (THIS PROJECT)

- ❌ **Do not edit** `dist/` directory contents - auto-generated by build
- ❌ **Do not edit** `docs/` directory contents - Typedoc auto-generated
- ❌ **Do not use** `@ts-ignore`, `@ts-expect-error`, `as any` - Type suppression forbidden
- ❌ **Do not import** Node.js-specific code in browser (e.g. `node:buffer`) - use `browser-mod.ts` entry

## UNIQUE STYLES

### Multi-Entry Point Strategy

Main package exports 9 different entry points:

- `.` - Core module
- `./browser` - Browser-specific
- `./http` - HTTP adapter
- `./deno` - Deno adapter
- `./chrome-extension` - Chrome extension
- `./socketio`, `./rabbitmq`, `./kafka`, `./redis-streams` - Message queue adapters

### Adapter Capability Declarations

Each adapter declares its transport capabilities:

```typescript
capabilities: IoCapabilities = {
	structuredClone: true, // Supports IoMessage objects
	transfer: true, // Supports zero-copy
	transferTypes: ["ArrayBuffer", "MessagePort"]
}
```

### Message Queue Empty Handling

Most adapters use message queue pattern:

```typescript
private messageQueue: string[] = []
private resolveRead: ((value: string | null) => void) | null = null
```

### Destroy Signal Pattern

7 adapters use `DESTROY_SIGNAL = "__DESTROY__"` for graceful shutdown:

- Worker, iframe, Chrome extension, WebSocket, Socket.IO, Hono, Elysia

## COMMANDS

```bash
# Dependencies
pnpm install

# Development mode (Turbo watch)
pnpm dev

# Build (tsdown + Typedoc)
pnpm build

# Tests (Bun)
pnpm test
pnpm --filter kkrpc test -- --watch

# Deno tests
pnpm --filter kkrpc test:deno

# Code quality
pnpm lint
pnpm format

# Version management (Changesets)
pnpm changeset
```

## NOTES

### Cross-Runtime Compatibility

- **stdio**: Node.js ↔ Deno ↔ Bun inter-process communication
- **Web Workers**: Browser + Deno native support
- **HTTP/WebSocket**: All runtimes
- **Message queues**: RabbitMQ/Redis/Kafka (all runtimes)

### Serialization Formats

- **superjson** (default): Supports Date, Map, Set, BigInt, Uint8Array
- **json**: Backward compatible, basic types
- **Auto-detection**: Receiver auto-detects format

### Data Validation

- **Standard Schema**: Compatible with Zod (v3.24+), Valibot (v1+), ArkType (v2+)
- **Two patterns**: Type-first (separate validators map) or Schema-first (defineMethod/defineAPI)
- **Bidirectional**: Each side validates its own exposed API
- **Error handling**: RPCValidationError with phase (input/output), method path, and issues array

### AI Skills

- **Location**: `skills/` directory contains SKILL.md files for Claude Code
- **kkrpc skill**: TypeScript usage patterns and best practices
- **interop skill**: Cross-language RPC implementation (Go, Python, Rust, Swift)
- **Usage**: Copy to `~/.claude/skills/` for AI-assisted development

### Transferable Object Performance

- **40-100x speedup**: Large data (>1MB) uses zero-copy
- **Supported types**: ArrayBuffer, MessagePort, ImageBitmap, OffscreenCanvas
- **Auto fallback**: Non-transferable transports auto-fallback to copy

### Browser Import

```typescript
// Browser environment uses dedicated entry
import { RPCChannel } from "kkrpc/browser"

// Server-side uses main entry
import { RPCChannel } from "kkrpc"
```

### Build Artifacts

- **dist/**: ESM + CJS + .d.ts type definitions
- **docs/**: Typedoc generated API documentation
- **Do not commit**: These directories are in .gitignore
