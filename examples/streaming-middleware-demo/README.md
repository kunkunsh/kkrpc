# Middleware Demo

Demonstrates kkrpc middleware over WebSocket with stable request/response APIs.

Stable kkrpc does not currently expose first-class remote iterator streaming. Until native streaming is added with protocol and test coverage, model continuous work with callbacks, evented transports, or explicit chunk/result arrays.

## What It Shows

### Middleware

- **Logging**: logs every RPC call with method name and args
- **Timing**: measures and prints execution time per call
- **Auth**: per-connection session; protected methods reject until `login()` succeeds
- **Rate limiting**: sliding-window counter; excess calls reject with an error

### Stable Continuous-Work Patterns

- **Countdown**: returns a `number[]`
- **Logs**: returns an array of log records
- **Task progress**: returns an array of progress records
- **Progress callback**: reports task progress through a callback argument

## Manual Testing

### ws library server

```bash
bun run server.ts
bun run client.ts
```

### Bun native WebSocket server

```bash
bun run server-bun.ts
bun run client.ts
```

Both servers listen on `ws://localhost:3100`.

## Middleware Model

Middleware handlers follow the onion model. Each handler receives `(ctx, next)`, can inspect or change `ctx.args`, can call `next()` to proceed, can transform the return value, or can throw to reject the RPC call.

```text
logger -> timing -> auth -> rateLimiter -> handler
```

Per-connection state, such as auth sessions, is stored in closure scope when each WebSocket connection creates its own API and middleware instances.
