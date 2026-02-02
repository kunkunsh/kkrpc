# kkrpc - TEST SUITE

**Generated:** 2026-02-03
**Location:** packages/kkrpc/**tests**

## OVERVIEW

Comprehensive Bun test suite covering 15+ transport adapters, stress tests, and regression tests. No mocks - all tests use real client/server setups.

## STRUCTURE

```
__tests__/
├── *.test.ts              # 15+ adapter/feature tests
├── scripts/               # Test helper scripts
│   ├── api.ts            # Shared API implementation
│   ├── bun-worker.ts     # Bun worker test script
│   └── *.ts              # Runtime-specific scripts
└── fixtures/             # Test fixtures (if needed)
```

## TEST FILES

| Test                       | Lines  | Coverage                       |
| -------------------------- | ------ | ------------------------------ |
| elysia-websocket.test.ts   | 18,691 | Elysia WebSocket adapter       |
| transfer.test.ts           | 8,928  | Zero-copy transferable objects |
| error-preservation.test.ts | 8,904  | Error object serialization     |
| redis-streams.test.ts      | 15,189 | Redis Streams adapter          |
| websocket.test.ts          | 2,833  | WebSocket client/server        |
| http.test.ts               | 2,829  | HTTP adapter                   |
| kafka.test.ts              | 4,276  | Kafka adapter                  |
| relay.test.ts              | 4,008  | Relay functionality            |
| nats.test.ts               | 5,148  | NATS adapter                   |
| rabbitmq.test.ts           | 3,613  | RabbitMQ adapter               |
| socketio.test.ts           | 3,922  | Socket.IO adapter              |
| hono-websocket.test.ts     | 3,488  | Hono WebSocket                 |
| elysia-simple.test.ts      | 2,789  | Basic Elysia tests             |
| stdio-rpc.test.ts          | 3,340  | Node.js/Deno/Bun stdio         |
| property-access.test.ts    | 3,884  | Remote getters/setters         |
| bun.worker.test.ts         | 1,514  | Bun Worker API                 |
| serialization.test.ts      | 1,610  | JSON/superjson                 |

## CONVENTIONS

### Test Structure

- **No mocks**: Real client/server communication
- **Bidirectional**: Both sides expose APIs and call each other
- **Stress testing**: High-concurrency operations (5000+ calls)
- **Shared API**: `scripts/api.ts` defines common test API

### Runtime Scripts

```typescript
// scripts/node-api.ts - Node.js server
// scripts/bun-worker.ts - Bun worker
// scripts/deno-api.ts - Deno server
```

### Test Pattern

```typescript
// Setup both sides
const serverRPC = new RPCChannel(serverIO, { expose: api })
const clientRPC = new RPCChannel(clientIO)
const api = clientRPC.getAPI<typeof api>()

// Bidirectional calls
expect(await api.add(1, 2)).toBe(3)
```

## ANTI-PATTERNS

- ❌ Don't mock IoInterface - test real adapters
- ❌ Don't skip stress tests - they catch race conditions
- ❌ Don't forget to call `io.destroy()` in cleanup
- ❌ Don't use `@ts-expect-error` without explanation

## COMMANDS

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Watch mode
bun test --watch

# Deno regression tests
deno test -R __deno_tests__
```
