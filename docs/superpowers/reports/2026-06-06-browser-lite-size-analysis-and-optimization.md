# Browser Lite Bundle Size Analysis And Optimization Notes

Date: 2026-06-06

Related implementation commit: `fde53eb feat(kkrpc): add superjson-free browser lite entry`

## Purpose

This document records the bundle-size measurements taken after adding `kkrpc/browser-lite`, compares the result with `comctx@1.6.1`, and outlines concrete optimization space for a future session.

The current `browser-lite` entry is intentionally not a micro RPC runtime. It keeps the full `RPCChannel` facade and most kkrpc protocol features, while removing the static SuperJSON dependency from the browser dependency graph.

## Current Browser Lite Implementation Summary

The implementation split serialization and channel wiring into:

- `packages/kkrpc/src/serialization-types.ts`: protocol-only shared types.
- `packages/kkrpc/src/serialization-json.ts`: JSON-only runtime used by browser-lite.
- `packages/kkrpc/src/serialization-full.ts`: SuperJSON-enabled full runtime.
- `packages/kkrpc/src/serialization.ts`: compatibility barrel that remains SuperJSON-enabled.
- `packages/kkrpc/src/channel-core.ts`: shared RPC state machine, parameterized by serialization runtime.
- `packages/kkrpc/src/channel.ts`: full `RPCChannel` wrapper.
- `packages/kkrpc/src/channel-lite.ts`: JSON-only `RPCChannel` wrapper.
- `packages/kkrpc/browser-lite-mod.ts`: public browser-lite package entry.

Verified behavior:

- `kkrpc/browser` keeps existing SuperJSON behavior.
- `kkrpc/browser-lite` preserves `new RPCChannel(io, options)` but uses JSON serialization.
- `browser-lite` rejects `serialization: { version: "superjson" }` with a clear runtime error.
- The bundle-check script walks the static import graph and rejects `superjson`, `copy-anything`, `is-what`, `serialization-full`, or `serialization.ts` compatibility chunks in the lite dependency path.

## Verification Already Run

Run from `packages/kkrpc` unless noted:

```bash
bun test __tests__/serialization.test.ts __tests__/transfer.test.ts __tests__/browser-lite.test.ts __tests__/middleware.test.ts __tests__/timeout.test.ts
```

Result:

```txt
40 pass
0 fail
101 expect() calls
```

Run from the parent workspace root:

```bash
pnpm --filter kkrpc check-types
pnpm --filter kkrpc check:browser-lite-bundle
```

Result:

- Typecheck passed.
- `check:browser-lite-bundle` passed.
- Build completed. Typedoc emitted existing warning-style output, but no errors.

## Measurement Setup

Temporary benchmark directory used during the session:

```txt
/var/folders/n6/tx2574_56h33v09wbc2hk_nm0000gn/T/opencode/kkrpc-bundle-compare
```

The examples expose a factory on `globalThis` so Bun does not dead-code-eliminate the entire import path. Measurements used:

```bash
bun build <entry>.js --target=browser --minify --outfile=<output>.js
```

Compressed sizes were calculated with Node/Bun `zlib`:

```ts
gzipSync(data, { level: 9 })
brotliCompressSync(data)
```

`comctx@1.6.1` was installed in the temp directory with:

```bash
pnpm add comctx --registry=https://registry.npmmirror.com --config.strict-ssl=false
```

The mirror and SSL override were only used because direct npm registry access failed in the environment during this session.

## Bundle Size Results

### Public Browser Entries

These use the public package browser entries and `WorkerParentIO`:

```ts
import { RPCChannel, WorkerParentIO } from "kkrpc/browser"
import { RPCChannel, WorkerParentIO } from "kkrpc/browser-lite"
```

Measured via local built dist files:

| Bundle | Modules | Raw minified | Gzip | Brotli |
| --- | ---: | ---: | ---: | ---: |
| `kkrpc/browser` | 25 | 32.40 KB | 9.94 KB | 8.82 KB |
| `kkrpc/browser-lite` | 6 | 21.07 KB | 6.16 KB | 5.42 KB |
| Difference | -19 | -11.32 KB | -3.78 KB | -3.40 KB |

Unminified reference:

| Bundle | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| `kkrpc/browser` | 66.06 KB | 14.33 KB | 12.57 KB |
| `kkrpc/browser-lite` | 39.65 KB | 8.38 KB | 7.32 KB |
| Difference | -26.41 KB | -5.95 KB | -5.25 KB |

Interpretation:

- `browser-lite` removes roughly 3.8 KB gzip from a minimal browser Worker bundle.
- The raw minified reduction is larger because SuperJSON and its helpers are compressible.

### Custom Tiny Adapter Entries

To determine whether adapters or the public browser re-export shape caused most of the size, the session also bundled direct imports of the channel wrappers with a tiny local Worker-like adapter.

| Demo | Raw minified | Gzip | Brotli | Modules |
| --- | ---: | ---: | ---: | ---: |
| `comctx@1.6.1` custom Worker adapter | 4.79 KB | 2.02 KB | 1.78 KB | 2 |
| `kkrpc-lite` direct channel + custom adapter | 20.83 KB | 5.96 KB | 5.25 KB | 10 |
| `kkrpc-superjson` direct channel + custom adapter | 32.16 KB | 9.73 KB | 8.65 KB | 27 |
| `kkrpc/browser-lite` public Worker example | 21.07 KB | 6.16 KB | 5.42 KB | 6 |
| `kkrpc/browser` public Worker example | 32.40 KB | 9.94 KB | 8.82 KB | 25 |

Interpretation:

- Choosing a smaller adapter does not materially change kkrpc size.
- Public `WorkerParentIO` vs custom tiny adapter changes lite gzip by only about 0.20 KB.
- The main size driver is `channel-core.ts`, not adapter code.
- `comctx` is much smaller because its core runtime has a narrower feature set.

## Module Contribution Breakdown

### kkrpc Lite Custom Adapter Bundle

Bun metafile summary for `kkrpc-lite` direct channel + custom adapter:

| Module | Minified contribution | Notes |
| --- | ---: | --- |
| `src/channel-core.ts` | 15.16 KB | Main size source. Full RPC state machine. |
| `src/serialization-json.ts` | 3.63 KB | JSON serializer, structured envelopes, transfer slots, error serialization. |
| custom adapter demo | 0.76 KB | Benchmark fixture, not package code. |
| `src/validation.ts` | 0.66 KB | Internal Standard Schema validation helpers, not Zod. |
| `src/channel-lite.ts` | 0.25 KB | Thin wrapper. |
| `src/utils.ts` | 0.12 KB | UUID helper. |
| `src/transfer.ts` | 0.11 KB | Transfer marker. |
| `src/middleware.ts` | 0.10 KB | Interceptor runner. |
| `src/transfer-handlers.ts` | 0.01 KB | Registry. |

Important: no Zod or Valibot is bundled. `validation.ts` is kkrpc's Standard Schema glue and is small.

### kkrpc SuperJSON Custom Adapter Bundle

Bun metafile summary for `kkrpc-superjson` direct channel + custom adapter:

| Module | Minified contribution | Notes |
| --- | ---: | --- |
| `src/channel-core.ts` | 15.18 KB | Same main core size. |
| `src/serialization-json.ts` | 3.28 KB | Shared JSON and structured-envelope support. |
| `superjson/dist/transformer.js` | 3.25 KB | Largest external SuperJSON module. |
| `superjson/dist/plainer.js` | 1.68 KB | SuperJSON internals. |
| `superjson/dist/index.js` | 1.67 KB | SuperJSON public runtime. |
| `superjson/dist/accessDeep.js` | 1.22 KB | SuperJSON internals. |
| `superjson/dist/is.js` | 0.83 KB | SuperJSON internals. |
| `src/validation.ts` | 0.66 KB | Internal validation glue. |
| `src/serialization-full.ts` | 0.56 KB | Thin SuperJSON wrapper. |
| `copy-anything` | 0.53 KB | SuperJSON dependency. |
| `is-what` visible contribution | about 0.13 KB | SuperJSON dependency. |

Interpretation:

- Browser-lite successfully removes the external SuperJSON graph.
- The remaining gap with comctx is not dependency bloat. It is kkrpc's feature-rich channel implementation.

### comctx Bundle

Bun metafile summary for `comctx@1.6.1` custom Worker adapter:

| Module | Minified contribution | Notes |
| --- | ---: | --- |
| `comctx/core/dist/index.js` | 4.42 KB | Nearly the entire bundle. |
| custom adapter demo | 0.34 KB | Benchmark fixture. |

Comctx bundle size:

- Raw minified: 4.79 KB.
- Gzip: 2.02 KB.
- Brotli: 1.78 KB.

## Why `channel-core.ts` Is Large

`channel-core.ts` contains the complete kkrpc state machine. Bundlers generally cannot drop unused class methods when `new RPCChannel(...)` and dynamic protocol dispatch are used, because any method can be reached at runtime through incoming messages or proxy traps.

Feature areas currently included in `channel-core.ts`:

| Feature area | Representative functions |
| --- | --- |
| Transport read loop and close handling | `listen`, `closeFromTransport`, `rejectPendingRequests` |
| String transport newline buffering | `bufferString`, `handleMessageStr` |
| Structured-clone transport messages | `handleIncomingMessage`, `sendMessage` |
| Method call request/response | `callMethod`, `handleRequest`, `handleResponse`, `sendResponse`, `sendError` |
| Callback function arguments | `invokeCallback`, `handleCallback`, `callbacks`, `callbackCache` |
| Remote property get/set | `getProperty`, `setProperty`, `handleGet`, `handleSet` |
| Remote constructor calls | `callConstructor`, `handleConstruct` |
| AsyncIterable streaming | `streamResult`, `createStreamIterable`, `handleStreamChunk`, `handleStreamEnd`, `handleStreamError`, `handleStreamCancel` |
| Validation and middleware hooks | `runValidation`, `runInterceptors`, `mergeValidatedArgs` |
| Transfer support | calls into `processValueForTransfer`, `reconstructValueFromTransfer` |
| Timeouts | `startTimeout`, `clearTimeout`, `RPCTimeoutError` |
| Nested proxy facade | `createNestedProxy`, proxy traps for `get`, `set`, `apply`, `construct` |
| Broadcast transport tolerance | `shouldIgnoreBroadcastRequestWithoutApi`, `shouldIgnoreBroadcastResolutionMiss` |

This explains why a smaller adapter barely changes the result: the core class is carrying most of the functionality.

## comctx Comparison Caveats

The comctx comparison is useful but not fully apples-to-apples.

Comctx provides:

- Method RPC across custom adapters.
- Callback support.
- Optional transfer extraction.
- Heartbeat and provider/injector roles.
- A small proxy model based on user-defined `defineProxy` namespaces.

kkrpc full/lite additionally provides or keeps support for:

- Multiple cross-runtime transport families through a common `IoInterface`.
- String transports and newline framing for stdio-style protocols.
- Structured-clone envelopes and transfer slot reconstruction.
- Remote nested property get and set.
- Remote constructor calls.
- AsyncIterable streaming protocol.
- Runtime validation hooks via Standard Schema.
- Middleware/interceptor hooks.
- Timeout errors and cleanup of pending requests.
- Rich error serialization and deserialization.
- Broadcast transport tolerance for missing APIs or paths.

Therefore, matching comctx's size likely requires a new smaller kkrpc entrypoint with fewer features, not just optimizing the current `browser-lite` path.

## Optimization Space

### Low-Risk Follow-Ups For Current Browser Lite

These can be considered without changing public semantics:

1. Add a reproducible bundle-size benchmark script.
   - Example path: `packages/kkrpc/scripts/compare-browser-bundle-size.ts`.
   - Use `Bun.build` or shell out to `bun build`.
   - Generate raw/gzip/brotli output for `browser`, `browser-lite`, and any future micro entry.
   - Keep examples small but prevent dead-code elimination by exporting or assigning factories to `globalThis`.

2. Keep the existing static graph check.
   - `scripts/check-browser-lite-bundle.ts` should remain focused on forbidden imports, not arbitrary string scanning.
   - Do not fail on user-facing strings that mention SuperJSON.

3. Inspect whether optional validation and middleware imports can be injected.
   - Current size contribution is small, about 0.76 KB combined for `validation.ts` and `middleware.ts` in the lite custom benchmark.
   - This is not the highest-priority optimization.

4. Inspect `serialization-json.ts` for a transfer-free variant.
   - Current contribution is about 3.63 KB minified.
   - A `serialization-json-basic.ts` with no transfer slots and less enhanced error support could be materially smaller.
   - This would require a new entrypoint or explicit option, because existing transfer behavior must remain intact.

### Medium-Risk Refactors

These may reduce size but need careful API design:

1. Split `channel-core.ts` by feature into smaller core variants.
   - A file split alone will not reduce bundle size if the public class still imports and dispatches every feature.
   - The split must be paired with separate entrypoints/classes that do not import unused features.

2. Create a `RPCMethodChannel` or similar internal implementation.
   - Method calls only.
   - Optional callbacks.
   - No property get/set.
   - No constructor calls.
   - No streaming.
   - No validation or middleware by default.
   - No string newline buffering if targeting browser structured-clone only.

3. Make streaming an opt-in entrypoint.
   - Streaming currently pulls in producer and consumer state machines.
   - Removing it from current `RPCChannel` would be breaking.
   - A separate `browser-method` or `browser-micro` entry can omit it safely.

4. Make remote property and constructor support opt-in.
   - These are mostly enabled by `createNestedProxy` and message handlers.
   - A method-only proxy can be much smaller.
   - This changes behavior for `await api.foo`, `api.foo = value`, and `new api.Ctor()`.

### High-Impact New Entry: `kkrpc/browser-micro`

Most promising path if size is the priority.

Goal:

- Compete more directly with comctx for browser-only RPC size.
- Keep the full `kkrpc/browser-lite` entry as the complete, SuperJSON-free option.

Possible scope:

- Browser-only, structured-clone/postMessage style transports.
- Method calls only: `api.method(...args)`.
- Optional callback arguments.
- Optional transfer support, or a separate `browser-micro-transfer` entry.
- JSON/string fallback only if necessary, ideally omitted.
- No property get/set.
- No constructor calls.
- No AsyncIterable streaming.
- No validation or middleware.
- Minimal error serialization.
- No broadcast transport special cases.
- No stdio newline buffering.

Potential user-facing import:

```ts
import { RPCChannel, WorkerParentIO } from "kkrpc/browser-micro"
```

or, to avoid implying exact parity with full `RPCChannel`:

```ts
import { MethodRPCChannel, WorkerParentIO } from "kkrpc/browser-micro"
```

API compatibility decision:

- If it exports `RPCChannel`, document that only method calls are supported.
- If it exports `MethodRPCChannel`, the limitation is clearer and avoids surprising users.

Expected effect:

- The current lite custom benchmark is about 5.96 KB gzip.
- Comctx custom benchmark is about 2.02 KB gzip.
- A method-only structured-clone kkrpc micro entry could plausibly get closer to comctx, but this has not been prototyped or measured.
- Do not promise a target until a prototype is bundled.

## Recommended Next-Session Plan

### Step 1: Add A Reproducible Size Benchmark

Create a script under `packages/kkrpc/scripts/` that:

- Builds minimal examples for:
  - `kkrpc/browser` public Worker path.
  - `kkrpc/browser-lite` public Worker path.
  - direct `channel-lite` + custom tiny adapter diagnostic path.
  - optional `comctx` comparison only if `comctx` is installed or can be fetched.
- Reports raw, gzip, and brotli sizes.
- Emits Bun metafile markdown or JSON for module contribution analysis.

Important benchmark details:

- Prevent DCE by exporting a function and assigning it to `globalThis`.
- Use equivalent example behavior across libraries.
- Separate public-entry benchmarks from internal diagnostic-entry benchmarks.
- Keep temp outputs outside tracked source or under ignored paths.

### Step 2: Prototype Method-Only Browser Core

Create a throwaway prototype first, not a polished API:

- `src/channel-method-core.ts` or temp file outside package source.
- Minimal message types: `request`, `response`, maybe `callback`.
- Minimal proxy: `get` returns a function proxy; `apply` sends a method call.
- No property await behavior.
- No set trap.
- No construct trap.
- No stream messages.
- No validators/interceptors.
- Structured messages only for browser transports if possible.

Benchmark the prototype before integrating it.

### Step 3: Decide Product Shape

Choose one:

1. `browser-lite` remains full-featured SuperJSON-free runtime, and a new `browser-micro` handles size-sensitive browser apps.
2. `browser-lite` becomes smaller and loses features. This is not recommended because the current implementation has already established lite as same-facade/full-feature minus SuperJSON.
3. Add option flags to `RPCChannel`. This is less likely to help bundle size unless options are compile-time and separate entrypoints avoid importing disabled features.

Recommendation: keep `browser-lite` as-is and add `browser-micro` or `browser-method` for size-sensitive use cases.

### Step 4: Add Tests For Any New Micro Entry

Minimum tests:

- Can call a remote method over a browser-like adapter.
- Can propagate remote errors.
- Can clean up pending calls on destroy/EOF if supported.
- If callbacks are included, can pass and invoke callback args.
- If transfer is included, can transfer `ArrayBuffer` over structured clone.
- Bundle check proves the micro entry excludes `serialization.ts`, `serialization-full.ts`, `superjson`, and any intentionally omitted feature modules.

### Step 5: Document Limitations Clearly

If a micro entry is added, README should include a decision table:

| Need | Entry |
| --- | --- |
| Full kkrpc browser behavior plus SuperJSON | `kkrpc/browser` |
| Full kkrpc browser behavior without SuperJSON | `kkrpc/browser-lite` |
| Smallest browser method-call runtime | `kkrpc/browser-micro` or `kkrpc/browser-method` |

## Risks And Constraints

- Do not break existing `RPCChannel` behavior for `kkrpc` or `kkrpc/browser`.
- Do not make `browser-lite` import `serialization.ts`, `serialization-full.ts`, or `superjson`.
- Do not assume file splitting alone reduces bundle size. Bundle measurements must prove it.
- Be careful with class-based APIs: methods on a class are often retained even if a specific app never calls them.
- Be explicit about unsupported features in any micro entry.
- Keep bundle-size checks based on static import graph, not raw string tokens.

## Current Best Interpretation

`kkrpc/browser-lite` achieved its intended goal: preserve the full kkrpc browser API shape while removing static SuperJSON dependency. It reduced a minimal browser Worker bundle by about 3.8 KB gzip compared with `kkrpc/browser`.

The next optimization target is not adapter size and not Zod-like dependencies. The next target is `channel-core.ts`. To make meaningful progress, introduce a smaller browser-only method-channel entrypoint with a deliberately reduced feature set, then benchmark it against comctx and the existing lite entry.
