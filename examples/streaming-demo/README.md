# Streaming Demo

Demonstrates kkrpc's AsyncIterable streaming over WebSocket.

## What it shows

- **Countdown** — finite stream, values arrive one per second
- **Log tail** — infinite stream, consumer cancels with `break`
- **Progress tracker** — structured data stream reporting task progress
- **Concurrent streams** — two streams running in parallel over one connection
- **Coexistence** — regular request/response calls work alongside streams

## Run

```bash
# Terminal 1 — start the server
bun run server.ts

# Terminal 2 — run the client
bun run client.ts
```

## How streaming works in kkrpc

1. Server method returns an `AsyncIterable` (async generator)
2. kkrpc detects it and sends chunks over the wire as `stream-chunk` messages
3. Client receives an `AsyncIterable` and reads it with `for await...of`
4. `break` sends `stream-cancel` back to stop the producer
5. Errors in the generator propagate to the consumer
