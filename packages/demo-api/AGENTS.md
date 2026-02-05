# kkrpc - DEMO API

**Generated:** 2026-02-05
**Location:** packages/demo-api

## OVERVIEW

Sample API types and implementations for testing and demonstrating kkrpc patterns. Used by test suites and examples.

## STRUCTURE

```
demo-api/
├── index.ts          # API types and implementations
└── package.json      # Package manifest
```

## API DEFINITIONS

### Simple API

```typescript
export type API = {
	echo: (message: string, callback?: (echo: string) => void) => Promise<string>
	add: (a: number, b: number, callback?: (sum: number) => void) => Promise<number>
}
```

### Nested API

```typescript
export type APINested = {
	echo: (message: string) => Promise<string>
	math: {
		grade1: { add: (a: number, b: number) => Promise<number> }
		grade2: { multiply: (a: number, b: number) => Promise<number> }
		grade3: { divide: (a: number, b: number) => Promise<number> }
	}
}
```

## USAGE

```typescript
import { apiImplementation, type API } from "@kksh/demo-api"

const rpc = new RPCChannel(io, { expose: apiImplementation })
const api = rpc.getAPI<API>()

await api.add(1, 2) // 3
await api.echo("hello") // "hello"
```

## NOTES

- Used by `__tests__/` for consistent test APIs
- Demonstrates callback support pattern
- Shows nested API structure (math.grade1.add)
- No runtime dependencies
