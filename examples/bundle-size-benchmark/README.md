# kkrpc Bundle Size Benchmark

This example builds small browser bundles with `Bun.build()` and compares the minified bundle size of equivalent remote `add(a, b)` proxy usage across `kkrpc` and `comctx`.

Each benchmark case exposes the same public shape:

```ts
interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}
```

The generated entry creates an `add` proxy and assigns it to `globalThis` so Bun cannot tree-shake away the core path being measured.

## Run

```bash
bun run benchmark
```

From the repository root:

```bash
pnpm --filter bundle-size-benchmark benchmark
```

## Cases

| Case                 | What it measures                                           |
| -------------------- | ---------------------------------------------------------- |
| `kkrpc core`         | `wrap()` from the main browser-safe core entry             |
| `kkrpc/browser core` | `wrap()` from the explicit browser entry                   |
| `kkrpc + json codec` | Core proxy plus `createTransport()` and `jsonCodec()`      |
| `kkrpc + superjson`  | Core proxy plus `createTransport()` and `superJsonCodec()` |
| `kkrpc/worker`       | Core proxy plus `workerTransport()`                        |
| `comctx`             | Equivalent proxy injection using `defineProxy()`           |

The report includes raw minified size, gzip size, brotli size, module count, and top metafile contributors for each bundle.
