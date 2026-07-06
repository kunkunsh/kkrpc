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
| `kkrpc core`         |     10.24 KB | 3.45 KB | 3.09 KB |       6 |
| `kkrpc/browser core` |     10.24 KB | 3.48 KB | 3.09 KB |       6 |
| `kkrpc + json codec` |     10.90 KB | 3.69 KB | 3.30 KB |       9 |
| `kkrpc + superjson`  |     21.94 KB | 7.45 KB | 6.68 KB |      24 |
| `kkrpc/worker`       |     10.56 KB | 3.56 KB | 3.19 KB |       8 |
| `kkrpc/streaming`    |     19.26 KB | 5.44 KB | 4.83 KB |       5 |
| `kkrpc/remote-refs`  |     21.72 KB | 5.98 KB | 5.28 KB |       6 |
| `comctx`             |      6.86 KB | 2.45 KB | 2.20 KB |       2 |
| `comlink`            |      4.10 KB | 1.87 KB | 1.64 KB |       2 |

Conclusion: for the equal add-proxy scenario, `comlink` is the smallest because it is focused on browser `postMessage`-style endpoints. `kkrpc core` includes the generic bidirectional channel, plugin hooks, callback arguments with garbage-collected reclamation, transport connection-close handling, per-call timeout/abort options, and transferable handling. Async iterator streaming and explicit Comlink-style remote references are measured separately as opt-in entries. The explicit browser entry is effectively the same size as core, adding JSON codec support remains small, worker support adds about 0.3 KB raw over core, and SuperJSON is the large optional feature because it bundles the `superjson` dependency.

The 2.1 lifecycle-hardening work (callback GC, connection lifecycle, per-call options, error hook, recursion caps) added about 3.5 KB raw / under 1 KB gzip / under 1 KB brotli to the shared channel chunk that every entry includes. See `results/2026-07-07-baseline.md` and `results/2026-07-07-post-polish.md` for the before/after comparison; the `comctx`/`comlink` control rows are unchanged across that measurement.

## Scope Notes

The rows above compare equivalent `add` API exposure plus remote proxy creation, but the libraries intentionally include different feature sets.

| Library              | Included in measured row                                                                                                                               | Not included in measured row                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `kkrpc core`         | Generic `Transport<RPCMessage>` channel, proxy creation, API exposure, top-level callback arguments, transfer descriptors, plugin-capable channel core | Runtime transports, JSON codec composition, SuperJSON, validation, middleware, inspector, relay, async iterator streaming, remote references |
| `kkrpc + json codec` | Core plus `createTransport()` and plain JSON serialization                                                                                             | SuperJSON, runtime transports, validation, middleware, inspector, relay                                                                      |
| `kkrpc + superjson`  | Core plus `createTransport()` and SuperJSON serialization for richer JS values                                                                         | Runtime transports, validation, middleware, inspector, relay                                                                                 |
| `kkrpc/worker`       | Core plus Web Worker transport helper                                                                                                                  | SuperJSON, validation, middleware, inspector, relay, non-worker runtime transports                                                           |
| `kkrpc/streaming`    | Core plus opt-in async iterable argument/result streaming with pull-based backpressure                                                                 | Remote references, SuperJSON, validation, middleware, inspector, relay, runtime transports                                                   |
| `kkrpc/remote-refs`  | Core plus explicit `proxy(value)` remote references, nested marked refs, release, and pass-back identity behavior                                      | Async iterator streaming, SuperJSON, validation, middleware, inspector, relay, runtime transports                                            |
| `comctx`             | `defineProxy()` API exposure/injection for the same `add` API                                                                                          | kkrpc-style runtime transport family, codec composition, SuperJSON row equivalent, validation, middleware, inspector, relay                  |
| `comlink`            | `expose()`/`wrap()` for the same `add` API on a Comlink endpoint                                                                                       | kkrpc-style runtime transport family, codec composition, SuperJSON row equivalent, validation, middleware, inspector, relay                  |

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
| `kkrpc/streaming`    | Opt-in core proxy plus async iterable streaming             |
| `kkrpc/remote-refs`  | Opt-in core proxy plus explicit `proxy()` remote references |
| `comctx`             | Equivalent proxy injection using `defineProxy()`            |
| `comlink`            | Equivalent browser endpoint proxy using `expose()`/`wrap()` |

The report includes raw minified size, gzip size, brotli size, module count, and top metafile contributors for each bundle.
