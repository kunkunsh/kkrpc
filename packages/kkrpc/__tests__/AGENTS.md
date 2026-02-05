# kkrpc - TEST SUITE

**Generated:** 2026-02-03
**Location:** packages/kkrpc/**tests**

## OVERVIEW

Comprehensive Bun test suite covering 17+ transport adapters, stress tests, and regression tests. No mocks - all tests use real client/server setups.

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

| Test                                   | Coverage                         |
| -------------------------------------- | -------------------------------- |
| bun.worker.test.ts                     | Bun Worker API                   |
| elysia-simple.test.ts                  | Basic Elysia tests               |
| elysia-websocket.test.ts               | Elysia WebSocket adapter         |
| error-preservation.test.ts             | Error object serialization       |
| hono-websocket.test.ts                 | Hono WebSocket                   |
| http.test.ts                           | HTTP adapter                     |
| kafka.test.ts                          | Kafka adapter                    |
| nats.test.ts                           | NATS adapter                     |
| property-access.test.ts                | Remote getters/setters           |
| rabbitmq.test.ts                       | RabbitMQ adapter                 |
| redis-streams.test.ts                  | Redis Streams adapter            |
| relay.test.ts                          | Relay functionality              |
| serialization.test.ts                  | JSON/superjson                   |
| socketio.test.ts                       | Socket.IO adapter                |
| stdio-benchmark.test.ts                | Stdio performance benchmarks     |
| stdio-large-data-benchmark.test.ts     | Stdio large data transfer        |
| stdio-rpc.test.ts                      | Node.js/Deno/Bun stdio           |
| transfer.test.ts                       | Zero-copy transferable objects   |
| websocket.test.ts                      | WebSocket client/server          |
| websocket-benchmark.test.ts            | WebSocket performance benchmarks |
| websocket-large-data-benchmark.test.ts | WebSocket large data transfer    |

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
