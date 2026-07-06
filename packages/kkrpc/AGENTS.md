# kkrpc - PACKAGE ROOT

**Generated:** 2026-06-09
**Location:** packages/kkrpc

## OVERVIEW

Main kkrpc package entry point with stable native RPC exports, runtime transport factories, feature plugins, build scripts, and package configuration.

## STRUCTURE

```
packages/kkrpc/
├── src/
│   ├── core/              # RPCChannel, protocol, transport primitives, plugins, transfer
│   ├── transports/        # Native transport factories
│   ├── features/          # Validation, middleware, SuperJSON
│   ├── entries/           # Public package entrypoint source files
│   └── relay.ts           # Transport relay helper
├── __tests__/             # Bun test suite
├── __deno_tests__/        # Deno regression tests
├── scripts/               # Build and test scripts
├── tsconfig.json          # TypeScript config
├── tsdown.config.ts       # Build configuration
├── package.json           # Package manifest
├── deno.json              # Deno package config
└── dist/                  # Build output, do not edit
```

## KEY FILES

| File                                                     | Purpose                         |
| -------------------------------------------------------- | ------------------------------- |
| File                                                     | Purpose                         |
| -------------------------------------------------------  | ------------------------------- |
| `src/entries/mod.ts`                                     | Main stable entry for core APIs |
| `src/entries/browser-mod.ts`                             | Browser-safe core entry         |
| `src/entries/deno-mod.ts`                                | Deno-friendly core entry        |
| `src/entries/transport.ts`                               | Transport primitives entry      |
| `src/entries/codecs.ts`                                  | Codec helpers entry             |
| `src/entries/plugins.ts`                                 | Plugin helpers entry            |
| `src/entries/worker.ts`, `src/entries/stdio.ts`          | Runtime transport entries       |
| `src/entries/http.ts`, `src/entries/ws.ts`               | Runtime transport entries       |
| `src/entries/validation.ts`, `src/entries/middleware.ts` | Feature entries                 |
| `src/entries/relay.ts`, `src/entries/inspector.ts`       | Relay and observability entries |
| `scripts/test.ts`                                        | Package test runner             |
| `scripts/prepare.ts`                                     | Deno type generation            |

## EXPORT STRATEGY

Package exports are stable subpaths for tree-shaking and runtime-specific imports:

```json
{
	"exports": {
		".": "./src/entries/mod.ts",
		"./browser": "./src/entries/browser-mod.ts",
		"./deno": "./src/entries/deno-mod.ts",
		"./worker": "./src/entries/worker.ts",
		"./stdio": "./src/entries/stdio.ts",
		"./http": "./src/entries/http.ts",
		"./ws": "./src/entries/ws.ts",
		"./electron": "./src/entries/electron.ts"
	}
}
```

## ENTRY POINT SELECTION

| Environment   | Entry Point                                                          |
| ------------- | -------------------------------------------------------------------- |
| Node.js       | `kkrpc` plus `kkrpc/stdio`, `kkrpc/ws`, or other transport subpaths  |
| Deno          | `kkrpc/deno` or `@kunkun/kkrpc`                                      |
| Bun           | `kkrpc`                                                              |
| Browser       | `kkrpc/browser`                                                      |
| Web Worker    | `kkrpc/worker`                                                       |
| Electron      | `kkrpc/electron`                                                     |
| Message buses | `kkrpc/rabbitmq`, `kkrpc/kafka`, `kkrpc/redis-streams`, `kkrpc/nats` |

## CONVENTIONS

- Entry files live in `src/entries/` and re-export stable APIs from `src/core/`, `src/transports/`, `src/features/`, or `src/relay.ts`.
- Browser entries avoid Node-specific stdio helpers.
- Deno entries avoid Node `process` assumptions.
- Build output is ESM plus CJS via tsdown.
- Type generation uses `scripts/prepare.ts`.
- New transport code should return `Transport<RPCMessage>` and declare capabilities when useful.

## COMMON FACTORIES

- `nodeStdioTransport()`, `denoStdioTransport()`, `bunStdioTransport()`
- `webSocketTransport()`, `webSocketClientTransport()`
- `workerTransport()`, `workerSelfTransport()`
- `httpClientTransport()`
- `electronIpcTransport()`, `electronUtilityProcessTransport()`
- `rabbitMqTransport()`, `kafkaTransport()`, `redisStreamsTransport()`, `natsTransport()`

## SCRIPTS

```bash
pnpm --filter kkrpc check-types
pnpm --filter kkrpc test
bun run build
bun run prepare
```

## NOTES

- See `src/AGENTS.md` for core implementation details.
- Root `AGENTS.md` covers monorepo-wide conventions.
- Do not edit `dist/` directly.
