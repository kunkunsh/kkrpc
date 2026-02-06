# Streaming + Middleware Demo

Demonstrates kkrpc's AsyncIterable streaming and interceptor middleware over WebSocket.

## What it shows

### Middleware (interceptors)

- **Logging** — logs every RPC call with method name and args
- **Timing** — measures and prints execution time per call
- **Auth** — per-connection session; protected methods reject with "Unauthorized" until `login()` is called
- **Rate limiting** — sliding-window counter (5 calls/sec); excess calls rejected with error

### Streaming (AsyncIterable)

- **Countdown** — finite stream, values arrive one per second
- **Log tail** — infinite stream, consumer cancels with `break`
- **Progress tracker** — structured data stream reporting task progress
- **Concurrent streams** — two streams running in parallel over one connection
- **Coexistence** — regular request/response calls work alongside streams

## Run

### Option 1: `ws` library (works with Node.js, Bun, Deno)

```bash
# Terminal 1 — start the server
bun run server.ts

# Terminal 2 — run the client
bun run client.ts
```

### Option 2: Bun native WebSocket (Bun only)

```bash
# Terminal 1 — start the Bun native server
bun run server-bun.ts

# Terminal 2 — run the client (same client works with both servers)
bun run client.ts
```

Both servers are interchangeable — the client connects to `ws://localhost:3100` and works the same way.

## How middleware works in kkrpc

Interceptors follow the **onion model** (like Koa, tRPC). Each interceptor wraps the next, and the innermost layer is the actual handler.

```
logger → timing → auth → rateLimiter → handler
```

- Interceptors receive `(ctx, next)` where `ctx` has `method`, `args`, and a shared `state` bag
- Call `next()` to proceed; skip it to short-circuit (e.g., auth rejection)
- Transform the return value to modify responses
- Throw to abort the call — the error propagates to the client

Per-connection state (like auth sessions) is achieved via closure scope — each connection creates its own interceptor instances.

## How streaming works in kkrpc

1. Server method returns an `AsyncIterable` (async generator)
2. kkrpc detects it and sends chunks over the wire as `stream-chunk` messages
3. Client receives an `AsyncIterable` and reads it with `for await...of`
4. `break` sends `stream-cancel` back to stop the producer
5. Errors in the generator propagate to the consumer
