# Deno Web Worker Demo

This is a demo of using kkrpc in a Deno environment with Web Workers (Deno supports Web Worker API without browser environment).

With the bidirectional RPC channel, the main thread can call methods in the worker thread and vice versa.

## Manual Testing

```bash
deno run --allow-read main.ts
```

### What To Verify

The terminal should print output similar to:

```text
worker loaded
from worker, calculated in main thread: api.add(38, 70) 108
from deno main thread: api.math.grade2.multiply(2, 3) =  6
```

This confirms bidirectional RPC works between the Deno main thread and the Deno Web Worker.

### Troubleshooting

- Run the command from `examples/deno-webworker-demo` so the relative worker path resolves.
- If Deno reports missing permissions, keep `--allow-read`; the worker source needs to be read from disk.
