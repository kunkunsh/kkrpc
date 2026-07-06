# Bundle-size after lifecycle-hardening 2.1 — 2026-07-07

Measured after the hardening work (callback GC, connection lifecycle, per-call
options, error hook, recursion caps). Compare with `2026-07-07-baseline.md`.

## Diff vs baseline (raw / gzip / brotli)

| Bundle | Baseline raw | Post raw | Δ raw | Δ gzip | Δ brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| `kkrpc core` | 6.78 KB | 10.24 KB | +3.46 KB | +0.96 KB | +0.87 KB |
| `kkrpc/worker` | 7.11 KB | 10.56 KB | +3.45 KB | +0.96 KB | +0.86 KB |
| `kkrpc/streaming` | 15.39 KB | 19.26 KB | +3.87 KB | +1.05 KB | +0.92 KB |
| `kkrpc/remote-refs` | 18.09 KB | 21.72 KB | +3.63 KB | +0.95 KB | +0.84 KB |
| `comctx` (control) | 6.86 KB | 6.86 KB | 0 | 0 | 0 |
| `comlink` (control) | 4.10 KB | 4.10 KB | 0 | 0 | 0 |

The growth lives in the shared channel chunk that every kkrpc entry includes, so
all entries grew by roughly the same absolute amount. The control libraries are
unchanged, confirming the comparison is apples-to-apples. Gzip/brotli — the better
proxies for production delivery — grew under ~1 KB for the substance added (callback
reclamation, connection-close handling, per-call timeout/abort, an error hook, and
recursion guards).

## Full report

| Bundle | Raw minified | Gzip | Brotli | Modules |
| --- | ---: | ---: | ---: | ---: |
| `kkrpc core` | 10.24 KB | 3.45 KB | 3.09 KB | 6 |
| `kkrpc/browser core` | 10.24 KB | 3.48 KB | 3.09 KB | 6 |
| `kkrpc + json codec` | 10.90 KB | 3.69 KB | 3.30 KB | 9 |
| `kkrpc + superjson` | 21.94 KB | 7.45 KB | 6.68 KB | 24 |
| `kkrpc/worker` | 10.56 KB | 3.56 KB | 3.19 KB | 8 |
| `kkrpc/streaming` | 19.26 KB | 5.44 KB | 4.83 KB | 5 |
| `kkrpc/remote-refs` | 21.72 KB | 5.98 KB | 5.28 KB | 6 |
| `comctx` | 6.86 KB | 2.45 KB | 2.20 KB | 2 |
| `comlink` | 4.10 KB | 1.87 KB | 1.64 KB | 2 |

### kkrpc core contributors

| Module | Bytes |
| --- | ---: |
| `../../packages/kkrpc/dist/channel-1QC6N1Pp.js` | 9.39 KB |
| `../../packages/kkrpc/dist/plugins-Df8n08GU.js` | 0.36 KB |
| `../../packages/kkrpc/dist/core-cn75MtLL.js` | 0.18 KB |
| `../../packages/kkrpc/dist/utils-4YUfjDAM.js` | 0.15 KB |
| `.bundle-size/kkrpc-core.ts` | 0.13 KB |

### kkrpc/browser core contributors

| Module | Bytes |
| --- | ---: |
| `../../packages/kkrpc/dist/channel-1QC6N1Pp.js` | 9.39 KB |
| `../../packages/kkrpc/dist/plugins-Df8n08GU.js` | 0.36 KB |
| `../../packages/kkrpc/dist/core-cn75MtLL.js` | 0.18 KB |
| `../../packages/kkrpc/dist/utils-4YUfjDAM.js` | 0.15 KB |
| `.bundle-size/kkrpc-browser-core.ts` | 0.13 KB |

### kkrpc + json codec contributors

| Module | Bytes |
| --- | ---: |
| `../../packages/kkrpc/dist/channel-1QC6N1Pp.js` | 9.39 KB |
| `../../packages/kkrpc/dist/transport.js` | 0.52 KB |
| `../../packages/kkrpc/dist/plugins-Df8n08GU.js` | 0.36 KB |
| `../../packages/kkrpc/dist/core-cn75MtLL.js` | 0.18 KB |
| `.bundle-size/kkrpc-json-codec.ts` | 0.16 KB |
| `../../packages/kkrpc/dist/utils-4YUfjDAM.js` | 0.15 KB |
| `../../packages/kkrpc/dist/codecs-D_gJI415.js` | 0.11 KB |

### kkrpc + superjson contributors

| Module | Bytes |
| --- | ---: |
| `../../packages/kkrpc/dist/channel-1QC6N1Pp.js` | 9.44 KB |
| `../../../uniview/node_modules/.pnpm/superjson@2.2.6/node_modules/superjson/dist/transformer.js` | 3.17 KB |
| `../../../uniview/node_modules/.pnpm/superjson@2.2.6/node_modules/superjson/dist/plainer.js` | 1.63 KB |
| `../../../uniview/node_modules/.pnpm/superjson@2.2.6/node_modules/superjson/dist/index.js` | 1.63 KB |
| `../../../uniview/node_modules/.pnpm/superjson@2.2.6/node_modules/superjson/dist/accessDeep.js` | 1.19 KB |
| `../../../uniview/node_modules/.pnpm/superjson@2.2.6/node_modules/superjson/dist/is.js` | 0.81 KB |
| `../../../uniview/node_modules/.pnpm/copy-anything@4.0.5/node_modules/copy-anything/dist/index.js` | 0.52 KB |
| `../../packages/kkrpc/dist/transport.js` | 0.52 KB |

### kkrpc/worker contributors

| Module | Bytes |
| --- | ---: |
| `../../packages/kkrpc/dist/channel-1QC6N1Pp.js` | 9.39 KB |
| `../../packages/kkrpc/dist/plugins-Df8n08GU.js` | 0.36 KB |
| `../../packages/kkrpc/dist/worker-DkDAJEf6.js` | 0.32 KB |
| `../../packages/kkrpc/dist/core-cn75MtLL.js` | 0.18 KB |
| `../../packages/kkrpc/dist/utils-4YUfjDAM.js` | 0.15 KB |
| `.bundle-size/kkrpc-worker.ts` | 0.14 KB |

### kkrpc/streaming contributors

| Module | Bytes |
| --- | ---: |
| `../../packages/kkrpc/dist/channel-1QC6N1Pp.js` | 9.39 KB |
| `../../packages/kkrpc/dist/streaming.js` | 9.13 KB |
| `../../packages/kkrpc/dist/plugins-Df8n08GU.js` | 0.36 KB |
| `.bundle-size/kkrpc-streaming.ts` | 0.20 KB |
| `../../packages/kkrpc/dist/utils-4YUfjDAM.js` | 0.15 KB |

### kkrpc/remote-refs contributors

| Module | Bytes |
| --- | ---: |
| `../../packages/kkrpc/dist/remote-refs.js` | 10.79 KB |
| `../../packages/kkrpc/dist/channel-1QC6N1Pp.js` | 9.40 KB |
| `../../packages/kkrpc/dist/remote-ref-BFEC_V6J.js` | 0.81 KB |
| `../../packages/kkrpc/dist/plugins-Df8n08GU.js` | 0.36 KB |
| `.bundle-size/kkrpc-remote-refs.ts` | 0.18 KB |
| `../../packages/kkrpc/dist/utils-4YUfjDAM.js` | 0.15 KB |

### comctx contributors

| Module | Bytes |
| --- | ---: |
| `../../node_modules/.pnpm/comctx@1.7.4/node_modules/comctx/core/dist/index.js` | 6.70 KB |
| `.bundle-size/comctx.ts` | 0.13 KB |

### comlink contributors

| Module | Bytes |
| --- | ---: |
| `../../node_modules/.pnpm/comlink@4.4.2/node_modules/comlink/dist/esm/comlink.mjs` | 3.95 KB |
| `.bundle-size/comlink.ts` | 0.13 KB |
