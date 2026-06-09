# kkrpc Next Native Migration Design

## Goal

Move repo tests, examples, docs, and AI-facing skills toward `kkrpc/next` without making classic
compatibility the primary development path. New examples and migrated tests should show native vNext usage
whenever a native vNext transport exists. Compatibility helpers remain available for users migrating
existing code, not as the preferred pattern for new code.

## Non-Goals

This design does not replace every classic adapter in one pass. HTTP, WebSocket, framework adapters,
Electron, Tauri, Chrome extension, iframe, and queue transports need separate native vNext transport
slices before their examples can be honestly migrated.

This design does not make `kkrpc/next` import classic adapters, validation, middleware, SuperJSON, or the
classic `RPCChannel`. Optional migration modules may depend on classic types, but the core entry must stay
small and feature-agnostic.

This design does not remove classic tests or examples immediately. Existing classic coverage remains useful
until native vNext coverage reaches parity.

## Current Context

The current vNext preview already has:

- native core APIs: `RPCChannel`, `wrap`, `expose`, and `dispose`
- native transport primitives: `Transport`, `Platform`, `Codec`, and `createTransport`
- native codecs: `objectCodec`, `jsonCodec`, and `jsonLineCodec`
- native Worker and stdio transports
- optional plugins for validation and middleware
- optional SuperJSON codec
- optional `classic-compat` facade for classic-style validators and interceptors

The repo still has many classic-first tests and examples. The largest migration blockers are transports
that only exist as classic `IoInterface` implementations today.

## Design Principles

- Native vNext is the default for new tests and examples.
- Compatibility helpers are explicit migration tools, not the examples' happy path.
- Bridge code must live behind a separate entry point and must not be imported by `kkrpc/next`.
- A test or example should not pretend to be native vNext if it still relies on a classic adapter bridge.
- Native vNext transport work should happen in small slices, one transport family at a time.
- AI migration instructions must be concrete enough for an agent to classify each file before editing it.

## Public Migration Shape

Add a migration guide at `packages/kkrpc/NEXT_MIGRATION.md`. It is both user-facing and AI-facing.

The guide should define this classification before any rewrite:

| File type | Action |
| --- | --- |
| Core API with in-memory, Worker, or stdio transport | Migrate to native `kkrpc/next` now |
| Validation or middleware examples | Migrate to native plugins under `kkrpc/next/validation` or `kkrpc/next/middleware` |
| SuperJSON examples | Migrate to native codec under `kkrpc/next/superjson` |
| Existing user code with classic validators/interceptors | Use `kkrpc/next/classic-compat` as a bridge |
| Existing user code with classic `IoInterface` adapter and no native next transport | Use `kkrpc/next/io` only as a temporary transport bridge |
| Repo tests/examples for adapters without native next transport | Leave classic or create a native transport first |

The guide should include a short AI migration checklist:

1. Identify the transport and entry point.
2. If a native vNext transport exists, migrate imports and API setup to native `wrap`, `expose`, or
   `RPCChannel`.
3. If no native vNext transport exists, do not rewrite the example as native. Either keep it classic or add
   a native transport in a dedicated slice.
4. Use `classic-compat` only for old option names such as `validators` and `interceptors`.
5. Use `next/io` only to let existing user-owned classic IO adapters run through vNext during migration.
6. Run the smallest focused test for the migrated file, then run `pnpm --filter kkrpc check-types`.

## Optional Classic IO Bridge

Add a separate entry point:

```ts
kkrpc/next/io
```

It exports a small bridge:

```ts
export interface IoTransportOptions {
	closeMode?: "signal-and-destroy" | "signal" | "destroy" | "none"
	onError?: (error: Error) => void
}

export function ioTransport(io: IoInterface, options?: IoTransportOptions): Transport<RPCMessage>
```

Behavior:

- Encode outbound `RPCMessage` values with `jsonCodec<RPCMessage>()` and pass strings to `io.write()`.
- Read inbound messages through `io.read()` in a background loop after the first subscriber attaches.
- Ignore empty string frames.
- Decode string frames with `jsonCodec<RPCMessage>()` and notify subscribers.
- If `io.read()` returns an `IoMessage` whose `data` is a string, decode that string.
- If `io.read()` returns an object-mode `IoMessage` or classic wire envelope, reject it for this first
  bridge slice with a clear error. Structured clone and transfer bridging can be designed later.
- If `io.read()` returns `null`, stop the read loop and do not notify subscribers again.
- If decoding or unsupported input fails, call `options.onError(error)` when provided. Without `onError`,
  rethrow the error asynchronously with `queueMicrotask()` so the failure is visible without adding an error
  channel to the `Transport` interface.
- Copy `broadcast` from `io.capabilities?.broadcast` to the vNext transport capability.
- Set `transfer: false`, because JSON string bridging cannot preserve transfer identity.
- On `close()`, default to calling `io.signalDestroy?.()` and then `io.destroy?.()`.
- `subscribe()` returns an unsubscribe function; the read loop can continue until close, but unsubscribed
  listeners must stop receiving messages.

The bridge intentionally sits outside `classic-compat`. `classic-compat` translates old option names into
plugins. `next/io` translates old transport instances into a vNext transport.

## Native Test And Example Migration Rules

Tests:

- Add `next-io.test.ts` only to prove the bridge itself.
- New vNext tests for Worker or stdio must import `kkrpc/next/worker` or `kkrpc/next/stdio`, not
  `kkrpc/next/io`.
- Queue, HTTP, WebSocket, Electron, Tauri, iframe, and Chrome extension tests should stay classic until
  native transports exist, unless the test is explicitly about bridge behavior.

Examples:

- New examples should prefer `wrap()` and `expose()` for one-way API exposure.
- Use `RPCChannel` when the example needs bidirectional APIs or explicit channel ownership.
- Native Worker examples should use `workerTransport()` and `workerSelfTransport()`.
- Native stdio examples should use `stdioJsonTransport()` or `nodeStdioTransport()`.
- Do not convert examples to `classic-compat` just to make imports look like vNext.
- If an example uses a classic-only adapter, add a migration note instead of rewriting it through the
  bridge, unless the example is specifically teaching bridge migration.

## Skill Updates

Update `skills/kkrpc/SKILL.md` so future AI agents choose the right path:

- The central pattern should become native vNext first: `wrap()`, `expose()`, and `RPCChannel` from
  `kkrpc/next`.
- The skill should include a short decision table: native next, classic stable, classic compat, or `next/io`
  bridge.
- The skill should state that repo tests and examples should use native vNext when possible.
- The skill should state that `classic-compat` is for users migrating old option names, not for new examples.
- The skill should state that `next/io` is a temporary bridge for existing classic adapters, not the native
  transport target.
- Existing classic adapter examples can remain, but should be labeled as classic or stable API examples.

Because skill edits are process documentation, update them with a small pressure scenario first: without the
new instructions, an AI agent would likely rewrite examples through `classic-compat` or `next/io`; with the
new instructions, it should choose native transports or leave blocked adapters classic.

## Documentation Updates

Update `packages/kkrpc/NEXT_ARCHITECTURE.md` to clarify the migration boundary:

- `kkrpc/next/io` exists for migration from existing `IoInterface` code.
- It is not a native vNext transport and should not be used as the default in new tests/examples.
- Native transport parity remains the long-term goal.

## First Implementation Slice

The first slice should produce working, testable software without broad example churn:

1. Add `NEXT_MIGRATION.md` with the AI migration checklist.
2. Add `kkrpc/next/io` bridge and focused tests for bridge behavior.
3. Add package export and build entry for `next/io`.
4. Update `NEXT_ARCHITECTURE.md` with bridge boundaries.
5. Update `skills/kkrpc/SKILL.md` with next-first guidance after running the skill pressure scenario.

After this slice, migrate actual examples/tests in separate native transport slices. The immediate next native
example candidates are Worker and stdio because they already have vNext transports.

## Verification

Focused verification for the first slice:

```bash
bun test __tests__/next-io.test.ts __tests__/next-core.test.ts __tests__/next-worker.test.ts __tests__/next-stdio.test.ts
pnpm --filter kkrpc check-types
```

If package exports or build entries change, also run:

```bash
pnpm --filter kkrpc build
```

Skill documentation should be reviewed for the exact bad migration behavior it is meant to prevent:

- Does it tell agents not to use `classic-compat` for new examples?
- Does it tell agents not to use `next/io` as a fake native transport?
- Does it explain when to leave a classic adapter example unchanged?
