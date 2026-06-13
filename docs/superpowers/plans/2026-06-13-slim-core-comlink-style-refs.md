# Slim Core and Comlink-Style References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the default `kkrpc` browser core bundle near the pre-streaming 6 KB raw baseline while keeping Comlink-style explicit remote references and async streaming available through opt-in entries.

**Architecture:** Keep `RPCChannel` as the minimal request/response + legacy top-level callback channel. Move async iterable streaming into a `StreamingRPCChannel` used by `kkrpc/streaming`. Move remote references into a `RemoteReferenceRPCChannel` used by `kkrpc/remote-refs`; explicit `proxy(value)` markers may appear nested inside plain arrays/objects in that entry, while fully automatic unmarked nested functions are reserved for a later opt-in auto feature.

**Tech Stack:** TypeScript, Bun tests, pnpm workspaces, tsdown package exports, kkrpc compact protocol, existing transports.

---

## File Structure

- Modify `packages/kkrpc/src/core/channel.ts`: revert to slim non-streaming/non-remote-ref channel with protected extension points where useful.
- Modify `packages/kkrpc/src/core/protocol.ts`: keep stream/ref protocol types as exported types, but keep default runtime request guard limited to `call/get/set/new`.
- Create `packages/kkrpc/src/core/streaming-channel.ts`: contains async iterable stream state, stream request/response handlers, and stream value encode/decode.
- Create `packages/kkrpc/src/core/remote-ref-channel.ts`: contains explicit `proxy()` marker encode/decode, `op: "ref"` handling, release lifecycle, object proxy support, and nested explicit marker traversal.
- Keep `packages/kkrpc/src/core/remote-ref.ts`: marker and public helpers (`proxy`, `releaseProxy`, `isRemoteProxy`).
- Create `packages/kkrpc/src/entries/streaming.ts`: exports streaming-enabled `RPCChannel`, `wrap`, and `expose` under the streaming entry.
- Create `packages/kkrpc/src/entries/remote-refs.ts`: exports remote-ref-enabled `RPCChannel`, `wrap`, `expose`, `proxy`, `releaseProxy`, and helper errors under the remote refs entry.
- Modify `packages/kkrpc/src/core/index.ts` and `packages/kkrpc/src/entries/mod.ts`: default exports no longer include remote-ref implementation APIs except types that do not retain runtime code.
- Modify `packages/kkrpc/package.json`, `packages/kkrpc/tsdown.config.ts`, and generated entry list: add `./streaming` and `./remote-refs` exports.
- Modify tests to import streaming tests from `../src/entries/streaming.ts` and remote-ref tests from `../src/entries/remote-refs.ts`.
- Modify `examples/bundle-size-benchmark/src/benchmark.ts` and README: report `kkrpc core`, `kkrpc/streaming`, and `kkrpc/remote-refs` separately.

---

### Task 1: Freeze the Bundle Regression with Tests

**Files:**
- Modify: `examples/bundle-size-benchmark/src/benchmark.ts`
- Modify: `examples/bundle-size-benchmark/README.md`

- [ ] Add separate benchmark cases for `kkrpc/streaming` and `kkrpc/remote-refs` so feature costs are visible instead of hidden in the core row.
- [ ] Run `pnpm --filter bundle-size-benchmark benchmark` and record the current failing baseline: core is expected to remain too large before extraction.

### Task 2: Restore Slim Default Channel

**Files:**
- Modify: `packages/kkrpc/src/core/channel.ts`
- Modify: `packages/kkrpc/src/core/index.ts`
- Modify tests importing streaming or remote refs from default entry.

- [ ] Revert default `RPCChannel` runtime behavior to request/response + legacy top-level callback + transfer descriptor handling only.
- [ ] Remove default channel fields for `localStreams`, `pendingStreams`, `remoteStreams`, `localRefs`, `remoteProxyRecords`, released ref caches, and recursive remote-ref rewriting.
- [ ] Keep small protected helpers for subclasses: `request()`, `post()`, `encodeValue()`, `decodeValue()`, `handleMessage()` where needed.
- [ ] Run `pnpm --filter kkrpc check-types` and focused core tests.

### Task 3: Extract Async Streaming Entry

**Files:**
- Create: `packages/kkrpc/src/core/streaming-channel.ts`
- Create: `packages/kkrpc/src/entries/streaming.ts`
- Modify: `packages/kkrpc/package.json`
- Modify: `packages/kkrpc/tsdown.config.ts`

- [ ] Move stream protocol runtime code from the previous default channel into `StreamingRPCChannel`.
- [ ] Export `RPCChannel = StreamingRPCChannel`, `wrap`, and `expose` from `kkrpc/streaming` for ergonomic use.
- [ ] Update streaming tests/docs/examples to import from `kkrpc/streaming` or local `entries/streaming.ts`.
- [ ] Run streaming-focused tests.

### Task 4: Extract Comlink-Style Explicit Remote References

**Files:**
- Create: `packages/kkrpc/src/core/remote-ref-channel.ts`
- Modify: `packages/kkrpc/src/core/remote-ref.ts`
- Create: `packages/kkrpc/src/entries/remote-refs.ts`
- Modify: `packages/kkrpc/package.json`
- Modify: `packages/kkrpc/tsdown.config.ts`

- [ ] Keep `proxy(value)` as an explicit marker, similar to Comlink.
- [ ] Support `proxy(fn)` and `proxy(obj)` at top level and nested inside plain arrays/objects when using `kkrpc/remote-refs`.
- [ ] Do not auto-proxy unmarked nested functions in the default explicit entry.
- [ ] Preserve `releaseProxy()` and object proxy `get/set/call` behavior in the remote refs entry.
- [ ] Move fully automatic unmarked nested function behavior out of default scope; add a skipped or separate TODO test only if needed.
- [ ] Run remote-ref-focused tests.

### Task 5: Update Public Docs, Examples, and Benchmark Expectations

**Files:**
- Modify: `docs/src/content/docs/guides/remote-references.md`
- Modify: `docs/src/content/docs/guides/streaming.md`
- Modify: `examples/remote-references-demo/`
- Modify: `examples/bundle-size-benchmark/README.md`

- [ ] Document the recommended API:

```ts
import { wrap, expose, proxy, releaseProxy } from "kkrpc/remote-refs"

await remote.run({ onProgress: proxy((value) => console.log(value)) })
```

- [ ] Document that automatic unmarked nested functions are intentionally not in the default core path.
- [ ] Document streaming as opt-in via `kkrpc/streaming`.
- [ ] Update benchmark table with separate feature rows.

### Task 6: Verification

**Files:** all changed files.

- [ ] Run `pnpm --filter kkrpc check-types`.
- [ ] Run `pnpm --filter bundle-size-benchmark check-types`.
- [ ] Run focused tests for core, streaming, remote refs, HTTP rejection, worker, validation, and transport codecs.
- [ ] Run `pnpm --filter bundle-size-benchmark benchmark`.
- [ ] Target result: `kkrpc core` returns close to the pre-streaming baseline (`~6 KB raw / ~2.4 KB gzip`), with `kkrpc/streaming` and `kkrpc/remote-refs` reported separately.

---

## Self-Review

- Spec coverage: covers default core size regression, previous streaming regression, Comlink-style explicit refs, nested `proxy(fn)`, opt-in advanced behavior, docs, examples, tests, and benchmarks.
- Placeholder scan: no TBD/TODO placeholders remain in required implementation steps; automatic unmarked nested functions are explicitly out of this implementation scope.
- Type consistency: entry names are `kkrpc/streaming` and `kkrpc/remote-refs`; channel classes are `StreamingRPCChannel` and `RemoteReferenceRPCChannel`; public helpers are `proxy`, `releaseProxy`, and `isRemoteProxy`.
