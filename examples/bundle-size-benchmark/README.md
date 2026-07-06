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
| `kkrpc core`         |      6.37 KB | 2.41 KB | 2.17 KB |       5 |
| `kkrpc/browser core` |      6.37 KB | 2.43 KB | 2.17 KB |       8 |
| `kkrpc + json codec` |      6.81 KB | 2.56 KB | 2.29 KB |       8 |
| `kkrpc + superjson`  |     17.64 KB | 6.23 KB | 5.60 KB |      20 |
| `kkrpc/worker`       |      6.70 KB | 2.53 KB | 2.28 KB |       7 |
| `kkrpc/streaming`    |     14.78 KB | 4.28 KB | 3.81 KB |       4 |
| `kkrpc/remote-refs`  |     16.85 KB | 4.79 KB | 4.24 KB |       5 |
| `comctx`             |      6.86 KB | 2.45 KB | 2.20 KB |       2 |
| `comlink`            |      4.10 KB | 1.87 KB | 1.64 KB |       2 |

Conclusion: for the equal add-proxy scenario, `comlink` is the smallest because it is focused on browser `postMessage`-style endpoints. `kkrpc core` is now in the same range as `comctx` while still including the generic bidirectional channel, plugin hooks, top-level callback arguments, and transferable handling. Async iterator streaming and explicit Comlink-style remote references are measured separately as opt-in entries. The explicit browser entry is effectively the same size as core, adding JSON codec support remains small, worker support adds about 0.33 KB raw over core, and SuperJSON is the large optional feature because it bundles the `superjson` dependency.

For context, the earlier all-in core measured `kkrpc core` at 22.01 KB raw / 6.09 KB gzip / 5.44 KB brotli with the same benchmark command. Keeping streaming and remote references behind subpath entries reduces the default core row by roughly 15.64 KB raw / 3.68 KB gzip / 3.27 KB brotli.

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
