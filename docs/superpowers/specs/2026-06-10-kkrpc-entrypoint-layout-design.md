# kkrpc Entrypoint Layout Design

## Goal

Move the public TypeScript entrypoint source files out of `packages/kkrpc/` and into
`packages/kkrpc/src/entries/` so the package root contains package metadata, build config,
documentation, tests, and scripts rather than dozens of one-line public entry files.

This is a source-layout refactor only. Published import paths must not change.

## Current Problem

`packages/kkrpc/` currently contains many TypeScript files such as `mod.ts`, `http.ts`,
`ws.ts`, `electron.ts`, `rabbitmq.ts`, and `inspector.ts`. These files are public package
entrypoints, but they sit beside unrelated root-level files like `package.json`, `deno.json`,
`tsdown.config.ts`, `README.md`, and scripts. This makes the package root noisy and harder to
scan.

There are also empty leftover directories under `packages/kkrpc/src/` from the removed classic
layout: `adapters/`, `next/`, and `inspector/`.

## Desired Layout

Create `packages/kkrpc/src/entries/` and move all public entrypoint source files there:

- `mod.ts`
- `browser-mod.ts`
- `deno-mod.ts`
- `transport.ts`
- `codecs.ts`
- `plugins.ts`
- `validation.ts`
- `middleware.ts`
- `superjson.ts`
- `worker.ts`
- `stdio.ts`
- `http.ts`
- `ws.ts`
- `ws-hono.ts`
- `ws-elysia.ts`
- `iframe.ts`
- `chrome-extension.ts`
- `electron.ts`
- `tauri.ts`
- `socketio.ts`
- `rabbitmq.ts`
- `kafka.ts`
- `redis-streams.ts`
- `nats.ts`
- `relay.ts`
- `inspector.ts`

Keep root-level config, scripts, docs, tests, generated files, and declarations in place.
`build.ts`, `dev.ts`, `deno.d.ts`, config files, README files, and documentation remain in the
package root.

Remove empty leftover directories:

- `packages/kkrpc/src/adapters/`
- `packages/kkrpc/src/next/`
- `packages/kkrpc/src/inspector/`

## Public API Contract

Published package import paths remain unchanged:

- `kkrpc`
- `kkrpc/browser`
- `kkrpc/deno`
- `kkrpc/http`
- `kkrpc/ws`
- `kkrpc/ws/hono`
- `kkrpc/ws/elysia`
- all existing transport, feature, relay, and inspector subpaths

The built files should remain named as they are today, for example `dist/mod.js`,
`dist/http.js`, `dist/ws.js`, and their CJS/type equivalents. Consumers should not observe a
package API change.

## Configuration Updates

Update these files to point at `src/entries/*` sources while preserving the existing `dist/*`
output names and public export names:

- `packages/kkrpc/tsdown.config.ts`
- `packages/kkrpc/deno.json`
- `packages/kkrpc/typedoc.json`

`package.json` should keep the same `exports` map to `dist/*` output paths unless the build
output names force a corresponding update. The intended result is no public export change.

## Import Rewrites

Moved entry files currently import implementation code using paths like `./src/core/index.ts`.
After moving to `src/entries/`, rewrite those imports to paths like `../core/index.ts`,
`../transports/http.ts`, and `../features/validation.ts`.

Implementation files under `src/core`, `src/features`, and `src/transports` should not be moved.

## Testing And Verification

Run focused package verification after the move:

- `pnpm --filter kkrpc check-types`
- `pnpm --filter kkrpc build`
- `pnpm --filter kkrpc test`
- `pnpm --filter kkrpc test:deno`
- `pnpm --filter kkrpc exec verify-package-export verify`

Also run export/leak searches to ensure removed old paths are not reintroduced and no active
source still references root entrypoint source files by filesystem path.

## Out Of Scope

- Changing published import paths.
- Moving implementation modules out of `src/core`, `src/features`, or `src/transports`.
- Adding root shims for source-level compatibility.
- Reworking documentation content beyond file path references needed for the layout change.
