# kkrpc - PACKAGE ROOT

**Generated:** 2026-01-17
**Location:** packages/kkrpc

## OVERVIEW

Main kkrpc package entry point with multi-runtime exports, build scripts, and package configuration.

## STRUCTURE

```
packages/kkrpc/
├── src/                    # Core implementation (see src/AGENTS.md)
├── __tests__/             # Bun test suite
├── __deno_tests__/        # Deno regression tests
├── mod.ts                 # Main entry (Node/Deno/Bun)
├── browser-mod.ts          # Browser entry
├── deno-mod.ts            # Deno-specific entry
├── http.ts                # HTTP adapter export
├── socketio.ts            # Socket.IO adapter export
├── rabbitmq.ts            # RabbitMQ adapter export
├── kafka.ts               # Kafka adapter export
├── redis-streams.ts       # Redis Streams adapter export
├── chrome-extension.ts      # Chrome Extension adapter export
├── scripts/               # Build and test scripts
├── tsconfig.json          # TypeScript config
├── tsdown.config.ts       # Build configuration
├── package.json           # Package manifest
├── deno.json             # Deno package config
└── dist/                 # Build output (do not edit)
```

## KEY FILES

| File               | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| mod.ts             | Main entry: exports all adapters (Node/Deno/Bun) |
| browser-mod.ts     | Browser entry: excludes stdio adapters           |
| deno-mod.ts        | Deno entry: exports Deno-compatible modules      |
| package.json       | Exports, dependencies, scripts, peer deps        |
| tsdown.config.ts   | Build: entry points, output formats              |
| scripts/test.ts    | Bun test runner with coverage                    |
| scripts/prepare.ts | Deno type generation                             |

## EXPORT STRATEGY

Package exports 9 entrypoints for tree-shaking:

```json
{
	"exports": {
		".": "./mod.ts",
		"./browser": "./browser-mod.ts",
		"./deno": "./deno-mod.ts",
		"./http": "./http.ts",
		"./socketio": "./socketio.ts",
		"./rabbitmq": "./rabbitmq.ts",
		"./kafka": "./kafka.ts",
		"./redis-streams": "./redis-streams.ts",
		"./chrome-extension": "./chrome-extension.ts"
	}
}
```

## ENTRY POINT SELECTION

| Environment | Entry Point                     |
| ----------- | ------------------------------- |
| Node.js     | `kkrpc` (mod.ts)                |
| Deno        | `kkrpc/deno` or `@kunkun/kkrpc` |
| Bun         | `kkrpc` (mod.ts)                |
| Browser     | `kkrpc/browser`                 |
| Chrome Ext. | `kkrpc/chrome-extension`        |

## CONVENTIONS

- **Entry re-exporting**: Each adapter export re-exports from `src/adapters/`
- **Browser exclusion**: `browser-mod.ts` excludes stdio adapters (Node/Deno/Bun)
- **Deno compatibility**: `deno-mod.ts` uses Deno-specific adapters only
- **Build output**: ESM + CJS dual format via tsdown
- **Type generation**: `scripts/prepare.ts` generates Deno types

## SCRIPTS

```bash
# Build
bun run build          # tsdown build

# Tests
bun test              # Run Bun tests
deno test -R __deno_tests__  # Deno regression

# Type generation
bun run prepare       # Generate Deno types
```

## NOTES

- See `src/AGENTS.md` for core implementation details
- See `src/adapters/AGENTS.md` for adapter patterns
- Root `AGENTS.md` for monorepo-wide conventions
