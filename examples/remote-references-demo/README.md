# Remote References Demo

This example demonstrates the opt-in `kkrpc/remote-refs` entry across a Worker boundary.

It covers:

- A returned plain object with an explicitly proxied nested function leaf: `createToast().hide()`.
- An explicitly proxied callback argument whose return value is awaited by the worker: `useCallback(proxy(fn))`.
- An explicitly proxied class instance: `createCounter()` returns `proxy(new CounterHandle())`.
- Deterministic cleanup through `releaseProxy()`.

Run:

```bash
pnpm --filter remote-references-demo demo
```

Expected output:

```text
hidden:hello
callback:from-worker
0
5
```
