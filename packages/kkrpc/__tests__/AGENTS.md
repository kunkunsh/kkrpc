# kkrpc - TEST SUITE

**Generated:** 2026-06-09
**Location:** packages/kkrpc/**tests**

## OVERVIEW

Comprehensive Bun test suite for the stable native architecture. Tests cover core proxy behavior, runtime transports, feature plugins/codecs, package exports, relay behavior, and test/build helper scripts. Prefer real client/server transports over mocks where feasible.

## STRUCTURE

```
__tests__/
├── *.test.ts              # Core, transport, feature, export, and script tests
└── scripts/
    ├── api.ts             # Shared API implementation
    ├── worker.ts          # Worker test script
    └── stable-worker.ts   # Stable worker test script
```

## TEST FILES

| Test                                      | Coverage                                 |
| ----------------------------------------- | ---------------------------------------- |
| `browser-bundle-benchmark-script.test.ts` | Browser bundle benchmark helpers         |
| `package-exports.test.ts`                 | Stable package export surface            |
| `middleware.test.ts`                      | Middleware plugin behavior               |
| `relay.test.ts`                           | Transport relay lifecycle and forwarding |
| `kafka.test.ts`                           | Kafka transport                          |
| `nats.test.ts`                            | NATS transport                           |
| `bus-envelope.test.ts`                    | Message-bus envelope routing helpers     |
| `redis-streams.test.ts`                   | Redis Streams transport                  |
| `rabbitmq.test.ts`                        | RabbitMQ transport                       |
| `electron-tauri.test.ts`                  | Electron and Tauri transport helpers     |
| `browser-boundary.test.ts`                | Browser entry boundary checks            |
| `bun.worker.test.ts`                      | Bun Worker API integration               |
| `websocket.test.ts`                       | WebSocket client/server transport        |
| `socketio.test.ts`                        | Socket.IO transport                      |
| `elysia-websocket.test.ts`                | Elysia WebSocket helper                  |
| `hono-websocket.test.ts`                  | Hono WebSocket helper                    |
| `http.test.ts`                            | HTTP transport                           |
| `worker.test.ts`                          | Worker transport                         |
| `stdio.test.ts`                           | Node, Deno, and Bun stdio transports     |
| `superjson.test.ts`                       | SuperJSON codecs/plugins                 |
| `validation.test.ts`                      | Validation plugin and schema helpers     |
| `transport-codecs.test.ts`                | Transport codec primitives               |
| `core.test.ts`                            | Stable core channel/proxy behavior       |
| `test-script.test.ts`                     | Package test runner behavior             |

## CONVENTIONS

### Test Structure

- Use real transports and real client/server setups when practical.
- Destroy channels and close transports in cleanup.
- Keep package export tests focused on stable entry points.
- Keep browser boundary tests free of Node-specific imports.

### Runtime Scripts

```text
scripts/api.ts - Shared API implementation
scripts/worker.ts - Worker test script
scripts/stable-worker.ts - Stable worker test script
```

### Test Pattern

```typescript
const serverChannel = new RPCChannel(serverTransport, { expose: api })
const clientChannel = new RPCChannel<object, typeof api>(clientTransport)
const remote = clientChannel.getAPI()

expect(await remote.add(1, 2)).toBe(3)
```

## ANTI-PATTERNS

- Do not mock native transports when a real transport can be exercised.
- Do not leave channels or transports open after tests.
- Do not import Node-specific modules from browser entry tests.
- Do not add type suppression comments without a specific justification.

## COMMANDS

```bash
bun test
bun test --coverage
bun test --watch
deno test -R __deno_tests__
```
