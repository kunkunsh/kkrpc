# kkrpc JSDoc Coverage Design

## Goal

Improve source-level documentation for the stable native `kkrpc` package so future readers can understand public APIs, entry points, transport factories, feature plugins, and key internal mechanics without reverse-engineering each file.

## Scope

Update JSDoc in these source directories:

- `packages/kkrpc/src/core/`
- `packages/kkrpc/src/transports/`
- `packages/kkrpc/src/features/`
- `packages/kkrpc/src/entries/`

The work is documentation-only. It must not change runtime behavior, public exports, package manifests, tests, generated `dist/`, or generated Typedoc output.

## Documentation Granularity

Use the "public exports plus key internals" level:

- Add module-level JSDoc to each file explaining the module's purpose, intended consumers, common imports, and important limitations.
- Add JSDoc to all exported functions, classes, interfaces, type aliases, and constants that are part of the stable source API.
- Add short explanatory comments for key internal helpers when they affect understanding of protocol routing, message validation, transfer handling, lifecycle, or transport handshake behavior.
- Do not add long comments to every private helper or obvious local variable.

## Entry Point Documentation

Every file in `src/entries/` should explain:

- Which published subpath it backs, such as `kkrpc/ws` or `kkrpc/validation`.
- Which runtime or user should import it.
- What it intentionally includes or excludes.
- A compact example import and usage snippet where useful.

Examples:

```ts
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"
```

```ts
import { RPCChannel } from "kkrpc/browser"
import { workerTransport } from "kkrpc/worker"
```

## Core Documentation

Core files should document the stable protocol and channel lifecycle:

- `channel.ts`: `RPCChannel`, `RPCChannelOptions`, request routing, callback envelopes, transfer descriptor consumption, timeouts, `destroy()`, and why malformed non-RPC frames are ignored.
- `index.ts`: `wrap()`, `expose()`, `dispose()`, `ExposedController`, and disposal mapping behavior.
- `protocol.ts`: compact request/response/callback records and field meanings.
- `transport.ts`: `Transport`, `Platform`, `Codec`, capability negotiation, and `createTransport()` behavior.
- `plugins.ts`: hook order and plugin responsibilities.
- `codecs.ts`: object, JSON, and JSON-line codec use cases.
- `transfer.ts`: how `transfer()` marks a value and when it is consumed.
- `utils.ts`: UUID helper purpose.

## Transport Documentation

Transport files should document how each factory maps a runtime primitive to `Transport<RPCMessage>`:

- Required runtime object shape or optional peer dependency.
- Directionality and lifecycle.
- Whether callbacks and server-initiated calls are supported.
- Capability flags such as object mode and transfer support.
- Minimal example code showing `wrap()`, `expose()`, or `RPCChannel` with the transport.

Important limitations must be explicit:

- HTTP is unary request/response and rejects callback arguments.
- Message bus transports require session/envelope routing to avoid self-delivery and cross-talk.
- iframe transports have handshake and ready-state behavior.
- Electron and Tauri transports accept narrow endpoint-like objects instead of importing runtime packages directly.

## Feature Documentation

Feature files should document plugin-level usage:

- `validation.ts`: Standard Schema compatibility, type-first validators, schema-first `defineMethod()` and `defineAPI()`, `extractValidators()`, and `RPCValidationError` handling.
- `middleware.ts`: receive-side onion middleware, context fields, and ordering relative to validation hooks when combined by the user.
- `superjson.ts`: when to use SuperJSON codecs and why they are intentionally separate from the core entry.

## Style Rules

- Keep comments factual and specific to the current stable native API.
- Prefer compact examples that compile conceptually without large setup blocks.
- Avoid removed API names except when explicitly documenting migration boundaries or exclusions.
- Avoid marketing language inside source comments.
- Use ASCII-only text unless the file already requires otherwise.
- Keep examples aligned with existing exports: `wrap()`, `expose()`, `RPCChannel`, and native `Transport<RPCMessage>` factories.

## Verification

Run these checks after implementation:

```bash
pnpm --filter kkrpc check-types
pnpm --filter kkrpc build
pnpm --filter kkrpc test
```

The package build runs Typedoc and package export verification through `postbuild`. Existing Typedoc warnings may remain if unrelated to this documentation pass, but no new TypeScript errors or test failures should be introduced.

## Success Criteria

- Every targeted source file has a module-level JSDoc.
- All public exports in the targeted directories have useful JSDoc.
- Key internal helpers that explain protocol behavior or transport lifecycle have concise comments.
- Source examples use stable native imports and do not reference removed classic adapters.
- Verification commands pass after the documentation-only changes.
