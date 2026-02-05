# kkrpc - NODE INTEROP

**Generated:** 2026-02-05
**Location:** interop/node

## OVERVIEW

Node.js/TypeScript test servers for kkrpc interop testing. Provides reference implementations that other language clients test against.

## STRUCTURE

```
node/
├── server.ts              # Stdio server for interop tests
└── ws-server.ts           # WebSocket server for interop tests
```

## KEY FILES

| File           | Purpose                                         |
| -------------- | ----------------------------------------------- |
| `server.ts`    | Stdio RPC server with math, echo, callback APIs |
| `ws-server.ts` | WebSocket RPC server (same API)                 |

## API IMPLEMENTED

```typescript
{
  math: {
    add(a: number, b: number): number
  },
  echo<T>(value: T): T,
  withCallback(value: string, cb: (payload: string) => void): string,
  counter: number,
  settings: {
    theme: string,
    notifications: { enabled: boolean }
  }
}
```

## USAGE

```bash
# Run stdio server (for Go/Python/Rust/Swift clients)
bun interop/node/server.ts

# Run WebSocket server
bun interop/node/ws-server.ts
```

## CONVENTIONS

- Uses `serialization.version = "json"` for cross-language compatibility
- SIGTERM/SIGINT handlers for graceful shutdown
- Same API exposed on both stdio and WebSocket transports

## NOTES

- Used by interop tests in other languages
- Reference implementation for protocol compliance
- No SuperJSON (JSON-only for interop)
