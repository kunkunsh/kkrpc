# Deno Web Worker Demo

This is a demo of using kkrpc in a Deno environment with Web Workers (Deno supports Web Worker API without browser environment).

With the bidirectional RPC channel, the main thread can call methods in the worker thread and vice versa.

```bash
deno run --allow-read main.ts
# output:
# worker loaded
# from worker, calculated in main thread: api.add(38, 70) 108
# from deno main thread: api.math.grade2.multiply(2, 3) =  6
```
