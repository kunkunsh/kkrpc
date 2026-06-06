# Browser Bundle Benchmark Design

Date: 2026-06-06

## Goal

Add a reproducible bundle-size benchmark for browser-facing kkrpc entries before making further runtime optimizations.

The benchmark should answer three questions:

- How large is `kkrpc/browser` for a minimal Worker-style usage?
- How much does `kkrpc/browser-lite` save without removing kkrpc features?
- How far is kkrpc from `comctx` on a comparable method-call sample?

The benchmark is diagnostic only. It must not reduce or change existing `browser` or `browser-lite` runtime behavior.

## Scope

Create `packages/kkrpc/scripts/compare-browser-bundle-size.ts`.

The script will generate small sample programs in a temporary directory and bundle them with Bun:

```bash
bun build <entry>.ts --target=browser --minify --outfile=<output>.js
```

It will measure:

- Raw minified bytes.
- Gzip bytes using `gzipSync` at level 9.
- Brotli bytes using `brotliCompressSync`.
- Module count and module contribution data when Bun exposes build outputs/metafile data.

## Benchmark Cases

The script should include these cases:

- `kkrpc/browser` public Worker path: imports `RPCChannel` and `WorkerParentIO` from `kkrpc/browser`.
- `kkrpc/browser-lite` public Worker path: imports `RPCChannel` and `WorkerParentIO` from `kkrpc/browser-lite`.
- Direct kkrpc lite diagnostic path: imports `RPCChannel` from `packages/kkrpc/src/channel-lite.ts` and uses a tiny local structured-clone adapter.
- `comctx` comparison path: imports `defineProxy` from installed `comctx` when resolvable, otherwise from the local `references/comctx/core/src/index.ts` source with the comctx `@/*` path alias mapped to `references/comctx/core/src/*`.

The public-entry cases measure what users import. The direct diagnostic case helps isolate whether the entrypoint adapters or the channel core dominate size. The comctx case gives a stable external baseline.

## Sample Program Shape

Each generated sample should exercise equivalent minimal behavior and prevent dead-code elimination by assigning a factory to `globalThis`.

The kkrpc samples should create a callable factory, not actually spawn a Worker during bundling:

```ts
import { RPCChannel, WorkerParentIO } from "kkrpc/browser-lite"

export function createRPC(worker: Worker) {
	const channel = new RPCChannel<{}, { add(a: number, b: number): Promise<number> }>(
		new WorkerParentIO(worker)
	)
	return channel.getAPI()
}

Object.assign(globalThis, { createRPC })
```

The direct diagnostic kkrpc case should use a tiny local `IoInterface` implementation to avoid measuring public adapter exports.

The comctx sample should mirror the same method-call use case with a tiny adapter:

```ts
import { defineProxy } from "comctx"

const [, injectMath] = defineProxy(() => ({
	add: async (a: number, b: number) => a + b
}))

export function createRPC(adapter: Parameters<typeof injectMath>[0]) {
	return injectMath(adapter)
}

Object.assign(globalThis, { createRPC })
```

## comctx Resolution

The script should include comctx by default. Because this repo already has `references/comctx`, the normal path should measure local comctx even when the package is not installed from npm.

Recommended behavior:

- Try resolving installed `comctx` from the current workspace or temporary benchmark directory.
- If not installed, bundle from `references/comctx/core/src/index.ts` and make Bun resolve comctx's `@/*` alias.
- If neither path works, print `skipped` for the comctx row with the resolution error.

This keeps the benchmark useful offline and avoids coupling normal kkrpc checks to registry availability.

## Output

Print a Markdown table suitable for copying into reports:

The table should have this shape, with every row filled from the current run:

| Bundle | Raw minified | Gzip | Brotli | Modules |
| --- | ---: | ---: | ---: | ---: |
| `kkrpc/browser` | measured bytes | measured bytes | measured bytes | measured count |
| `kkrpc/browser-lite` | measured bytes | measured bytes | measured bytes | measured count |
| `kkrpc-lite direct` | measured bytes | measured bytes | measured bytes | measured count |
| `comctx` | measured bytes or skipped | measured bytes or skipped | measured bytes or skipped | measured count or skipped |

Also print the top module contributors per bundle when available:

Contributor tables should list the top measured modules for each successful bundle, ordered by byte contribution.

## Package Integration

Add a package script such as:

```json
"compare:browser-bundle-size": "pnpm build && bun run scripts/compare-browser-bundle-size.ts"
```

The existing `check:browser-lite-bundle` remains unchanged and continues to enforce the no-SuperJSON static import graph. The new comparison script is observational and should not fail on size thresholds initially.

## Non-Goals

- Do not reduce `browser-lite` features in this change.
- Do not introduce a `browser-micro` runtime in this change.
- Do not make bundle-size thresholds part of CI yet.
- Do not edit generated `dist/` or Typedoc output.
- Do not require network installs for normal execution.

## Testing

Verification should include:

- `pnpm --filter kkrpc check-types`
- `pnpm --filter kkrpc compare:browser-bundle-size`
- `pnpm --filter kkrpc check:browser-lite-bundle`

If comctx cannot be resolved locally, the comparison script may still pass with a skipped comctx row, but manual validation should be run in an environment where `comctx` is available.

## Future Runtime Optimization Direction

After this benchmark is in place, optimize without reducing current `browser-lite` functionality by preferring additive product shapes:

- Keep `kkrpc/browser-lite` as the full-feature, SuperJSON-free browser runtime.
- If size-sensitive users need a smaller runtime, prototype a separate `browser-micro` or `MethodRPCChannel` entrypoint.
- Use this benchmark to prove whether any refactor actually reduces bundle size.
