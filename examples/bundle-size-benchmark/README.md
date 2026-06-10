# kkrpc Bundle Size Benchmark

This example builds small browser bundles with `Bun.build()` and compares the minified bundle size of equivalent remote `add(a, b)` proxy usage across `kkrpc`, `comctx`, and `comlink`.

Each benchmark case exposes the same public shape:

```ts
interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}
```

The generated entry exposes the same local `add` API, creates a remote `add` proxy, and assigns it to `globalThis` so Bun cannot tree-shake away the core path being measured.

## Latest Result

Measured with `pnpm --filter bundle-size-benchmark benchmark` on the current workspace build. All rows define/expose the same `add(a, b)` API and create a remote add proxy.

| Bundle               | Raw minified |    Gzip |  Brotli | Modules |
| -------------------- | -----------: | ------: | ------: | ------: |
| `kkrpc core`         |      5.96 KB | 2.29 KB | 2.06 KB |       5 |
| `kkrpc/browser core` |      5.96 KB | 2.31 KB | 2.06 KB |       8 |
| `kkrpc + json codec` |      6.40 KB | 2.44 KB | 2.18 KB |       9 |
| `kkrpc + superjson`  |     17.23 KB | 6.12 KB | 5.51 KB |      21 |
| `kkrpc/worker`       |      6.27 KB | 2.41 KB | 2.15 KB |       7 |
| `comctx`             |      6.86 KB | 2.45 KB | 2.20 KB |       2 |
| `comlink`            |      4.10 KB | 1.87 KB | 1.64 KB |       2 |

Conclusion: for the equal add-proxy scenario, `comlink` is the smallest because it is focused on browser `postMessage`-style endpoints. `kkrpc core` is larger than `comlink`, but smaller than `comctx` in raw, gzip, and brotli output while also being the base for a broader transport/plugin architecture. The explicit browser entry is effectively the same size as core, adding JSON codec support is small, worker support adds about 0.31 KB raw over core, and SuperJSON is the large optional feature because it bundles the `superjson` dependency.

## Scope Notes

The rows above compare equivalent `add` API exposure plus remote proxy creation, but the libraries intentionally include different feature sets.

| Library              | Included in measured row                                                                                                    | Not included in measured row                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `kkrpc core`         | Generic `Transport<RPCMessage>` channel, proxy creation, API exposure, callback marker support, plugin-capable channel core | Runtime transports, JSON codec composition, SuperJSON, validation, middleware, inspector, relay                             |
| `kkrpc + json codec` | Core plus `createTransport()` and plain JSON serialization                                                                  | SuperJSON, runtime transports, validation, middleware, inspector, relay                                                     |
| `kkrpc + superjson`  | Core plus `createTransport()` and SuperJSON serialization for richer JS values                                              | Runtime transports, validation, middleware, inspector, relay                                                                |
| `kkrpc/worker`       | Core plus Web Worker transport helper                                                                                       | SuperJSON, validation, middleware, inspector, relay, non-worker runtime transports                                          |
| `comctx`             | `defineProxy()` API exposure/injection for the same `add` API                                                               | kkrpc-style runtime transport family, codec composition, SuperJSON row equivalent, validation, middleware, inspector, relay |
| `comlink`            | `expose()`/`wrap()` for the same `add` API on a Comlink endpoint                                                            | kkrpc-style runtime transport family, codec composition, SuperJSON row equivalent, validation, middleware, inspector, relay |

Use the core rows to compare the minimum proxy/channel cost. Use the codec and worker rows to see the incremental cost of optional `kkrpc` features.

## Run

```bash
bun run benchmark
```

From the repository root:

```bash
pnpm --filter bundle-size-benchmark benchmark
```

## Cases

| Case                 | What it measures                                            |
| -------------------- | ----------------------------------------------------------- |
| `kkrpc core`         | `wrap()` from the main browser-safe core entry              |
| `kkrpc/browser core` | `wrap()` from the explicit browser entry                    |
| `kkrpc + json codec` | Core proxy plus `createTransport()` and `jsonCodec()`       |
| `kkrpc + superjson`  | Core proxy plus `createTransport()` and `superJsonCodec()`  |
| `kkrpc/worker`       | Core proxy plus `workerTransport()`                         |
| `comctx`             | Equivalent proxy injection using `defineProxy()`            |
| `comlink`            | Equivalent browser endpoint proxy using `expose()`/`wrap()` |

The report includes raw minified size, gzip size, brotli size, module count, and top metafile contributors for each bundle.
