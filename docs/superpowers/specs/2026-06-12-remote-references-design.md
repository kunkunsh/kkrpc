# Remote References Design

Date: 2026-06-12

## Context

Kunkun's migration to kkrpc 1.0 exposed structured-clone failures in Worker-backed plugin UI channels. Two concrete incidents motivated this design:

- `PointerEvent` handler arguments crossed a Worker boundary and failed with `DataCloneError: PointerEvent object could not be cloned`. Uniview fixed this at the host adapter boundary by sanitizing event handler arguments before calling kkrpc.
- `showToast()` returned an object with function properties, such as `{ hide: async () => {} }`. In Worker object-mode, that response cannot be structured-cloned, so the caller waited until the kkrpc request timed out. Kunkun mitigated this by changing the host RPC contract to return `void` and keeping the public `ToastInstance` object local to the SDK.

The old `/Users/hk/Dev/kkrpc` branch and the new `vendors/kkrpc` implementation both support callback functions only in method argument positions. They do not recursively encode functions nested inside arrays, objects, or return values. The old implementation often used JSON string messages, which silently dropped function values; the new Worker transport uses structured clone by default, which makes the problem visible as `DataCloneError`.

The goal of this design is to make callback and proxy behavior first-class instead of relying on JSON dropping unsupported values or host adapters manually flattening every callback-like value.

## Approved Direction

Implement the full remote-reference feature inside kkrpc's existing compact request/response protocol. Remote references should be a channel-level protocol feature, not a codec feature and not a transport-specific side channel.

The implementation should reuse the current `RPCChannel` request pipeline for remote-reference operations. Reference calls, object property reads, object property writes, and object method calls should be normal `RPCRequest` / `RPCResponse` exchanges with a dedicated internal operation, not a user-visible path namespace. This keeps timeouts, write-failure handling, metadata, plugin hooks, and request observability consistent with ordinary API calls without colliding with user APIs.

The initial implementation target is the complete feature set:

- Recursive function references in arguments, return values, stream chunks, callback arguments, setter values, constructor arguments, and serializable error custom fields.
- Request/response based function callbacks, so callback return values and thrown errors propagate.
- Passing remote proxies back through later calls without losing the ability to invoke the original local reference.
- Explicit object proxy support through `proxy(value)`.
- Deterministic `releaseProxy()` cleanup and channel destroy cleanup. Best-effort `FinalizationRegistry` release remains a supported follow-up, but not a correctness requirement for the first implementation batch.
- Transport capability gating so one-shot HTTP keeps rejecting remote refs clearly.
- Worker structured-clone compatibility without `DataCloneError` for function leaves.

Design Lab review on 2026-06-12 tightened this direction in five ways:

- Use `op: "ref"` in the existing request shape instead of `p: ["$ref", ...]`, avoiding user API path collisions.
- Remove new emission of `RPCCallback` (`t: "cb"`) messages; source-level callback arguments are still supported through remote refs.
- Treat recursive encoding as a copy-on-write value transformer, not as a full graph serialization layer.
- Add explicit transport capability and rollback semantics before registering refs.
- Make `releaseProxy()` consistently asynchronous and backed by global proxy metadata.
- Treat `FinalizationRegistry` as optional best-effort cleanup after deterministic release paths work.

## Reference Project Findings

Two local reference projects were reviewed:

- `/Users/hk/Dev/kkrpc/references/comlink`
- `/Users/hk/Dev/kkrpc/references/comctx`

Comlink's useful patterns are its public lifecycle API and type model: `proxy(value)` explicitly marks objects for by-reference transfer, `releaseProxy` deterministically detaches a proxy, and `FinalizationRegistry` sends best-effort cleanup when proxies are garbage-collected. Comlink also demonstrates one way to proxy constructed instances, but constructor-like proxy behavior remains out of scope for kkrpc's initial remote-reference implementation; normal cloneable data remains by-value.

Comlink's MessagePort-per-proxy transport model should not be copied. kkrpc already has bidirectional transports and a compact request/response protocol across Worker, WebSocket, stdio, iframe, Electron, Tauri, and message buses. Creating a new `MessageChannel` for every nested reference would not work for non-browser transports and would bypass kkrpc plugins, metadata, timeout handling, and diagnostics.

Comctx's useful patterns are smaller: path-based proxy calls, callback IDs, and namespace-style routing. Its callback behavior remains fire-and-forget, so it is not sufficient for kkrpc's callback return value requirement. Its bridge pattern confirms that passing an existing proxy through another RPC call should preserve the ability to route calls back to the original owner.

The resulting kkrpc design should use Comlink's public ergonomics and cleanup semantics, while keeping kkrpc's own transport-neutral request/response routing.

## Current Repo Fit

The stable implementation is already close to the desired architecture:

- `packages/kkrpc/src/core/channel.ts` funnels request arguments, setter values, responses, stream control values, and stream chunks through `encodeValue()` / `decodeValue()`.
- `request()` already registers pending requests before sending, applies timeouts, forwards metadata, and rejects write failures.
- `handleRequest()` already runs plugin hooks, invokes local API handlers, and serializes responses.
- `destroy()` already rejects pending requests and clears callback and stream registries.
- Worker transports use object-mode `postMessage()`, so replacing functions with reference envelopes before send directly addresses the `DataCloneError` failure mode.

The main gap is that `encodeValue()` is shallow and current callback support is separate from normal requests:

- Top-level function arguments are encoded in `encodeArgs()` as `__kkrpc_next_arg__` callback envelopes.
- Callback invocation uses `RPCCallback` (`t: "cb"`) and does not return a value or error.
- Return values and nested values are not recursively scanned for functions.

The implementation should replace this special callback path with the generic remote-reference registry while preserving compatibility for existing top-level function argument use cases.

## Goals

- Support function references anywhere in an RPC value graph, including nested arguments, nested return values, arrays, plain objects, Maps, Sets, and error custom fields where the active transport/codec can preserve those containers.
- Make remote function calls request/response based, so `await remoteCallback()` resolves or rejects with the remote callback result.
- Support passing remote references back through later RPC calls without losing remote-ref identity.
- Provide explicit remote object proxy support for class instances or service objects that should be interacted with remotely instead of cloned.
- Keep normal data objects by-value by default for compatibility, performance, and security.
- Enable the feature by default for TypeScript-to-TypeScript kkrpc channels.
- Provide deterministic cleanup through `releaseProxy()` / disposal APIs and channel destruction. Best-effort garbage-collection finalizers are optional follow-up cleanup, not a correctness dependency.
- Preserve existing structured-clone transfer support for large binary values.
- Produce useful error messages when a value still cannot be encoded or transported.
- Keep interop-friendly modes possible by allowing remote references to be disabled for non-TypeScript or external-language transports.

## Non-Goals

- Do not make JSON or SuperJSON responsible for callbacks. Codecs encode data; remote references are an RPC protocol feature.
- Do not automatically remote-proxy every object. Plain objects, arrays, Maps, and Sets should still be sent by value unless they contain remote-reference leaves.
- Do not rely only on `FinalizationRegistry` for cleanup. It is best-effort and non-deterministic.
- Do not expose DOM events, DOM nodes, Electron objects, or host internals as remote proxies by accident.
- Do not require users to manually release every short-lived callback passed as a one-shot function argument, but do provide a way to release long-lived refs.

## Known Current Behavior

Old kkrpc branch `/Users/hk/Dev/kkrpc`:

- `channel-core.ts` registers callbacks in `callMethod()` by mapping top-level function arguments to `__callback__<id>` placeholders.
- Incoming request handling maps top-level callback placeholders back to functions that send callback messages.
- `sendResponse()` does not recursively register functions in return values.
- `callbacks` are retained until channel cleanup or manual `clearCallbacks()`.

New kkrpc in `vendors/kkrpc`:

- `RPCChannel.encodeArgs()` registers top-level function arguments as callback envelopes.
- `RPCChannel.encodeValue()` handles transfer descriptors and async iterables, then returns the value unchanged.
- `RPCChannel.destroy()` clears callbacks, pending requests, and stream state.
- Worker transport uses direct `postMessage()` object-mode structured clone.

Therefore, both implementations support function arguments, but neither supports functions nested inside return values or arbitrary value graphs.

## Recommended Architecture

Add a protocol-level Remote Reference system to `RPCChannel`. It should sit above codecs and below user APIs.

### Value Encoding

Every outbound request argument, setter value, constructor argument, callback argument, response value, and stream chunk should pass through one recursive value encoder.

The encoder should:

- Convert local functions into remote-reference envelopes.
- Preserve existing remote proxy envelopes when a proxy received from one side is passed back later.
- Recursively walk plain objects, arrays, Maps, Sets, Dates, Errors, and custom enumerable fields where existing serialization supports them.
- Preserve transfer descriptors and async iterable refs.
- Preserve remote-reference identity for repeated function or explicit object-proxy targets.
- Use copy-on-write transformation for by-value containers instead of mutating user values.
- Leave normal structured-clone-safe values by value.
- Reject or explicitly proxy non-cloneable non-function objects according to a channel policy.

Proposed envelope shape:

```ts
interface RemoteRefEnvelope {
	readonly __kkrpc_ref__: true
	readonly id: string
	readonly kind: "function" | "object"
}
```

The exact field names can be compacted later, but they must not collide with user data. A symbol is not suitable on the wire; use a reserved object marker and escape user objects that already contain it.

Implementation detail for this repo:

- Keep the existing async-iterable envelope behavior, but detect it before recursively walking object fields.
- Keep `transfer()` as an object-level descriptor that is consumed only when `supportsTransfer` is true. If a transferred object is sent by transfer descriptor, do not also recursively rewrite its internals.
- Rework `encodeArgs()` to become a thin wrapper around recursive `encodeValue()` for each argument. It may keep the current `__kkrpc_next_arg__` value envelope for compatibility, but new function refs should be encoded as `RemoteRefEnvelope`, not `callback` envelopes.
- Do not add legacy wire compatibility for old `callback` envelopes unless a concrete external interop requirement appears. Existing source-level callback arguments remain supported because both ends of a current kkrpc channel will encode them as remote refs.
- Use copy-on-write semantics: return the original value when no rewriting occurs anywhere below it, and create shallow copies only along paths where function refs or explicit object refs are inserted. Do not mutate caller-owned values.
- Do not introduce a generic by-value graph/back-reference format in the first implementation. Plain object graph cycles and repeated plain-object identity remain the responsibility of the active transport/codec. If a cyclic by-value container also requires rewriting because it contains a function or explicit object-proxy leaf, encoding should reject with `RPCEncodeError` and a useful value path rather than producing an incomplete graph.
- Plain objects, arrays, Maps, Sets, Dates, RegExps, ArrayBuffers, typed arrays, and other cloneable built-ins should remain by-value unless they contain function leaves or explicitly proxied object leaves. Map and Set support is limited to transports/codecs that already preserve Map and Set by-value semantics, such as object-mode structured clone or SuperJSON codecs; JSON-only codecs still have their existing Map/Set limitations.
- Errors should keep `name`, `message`, `stack`, and enumerable custom fields. Custom fields should pass through recursive encoding so nested callbacks in error metadata do not cause structured-clone failures.

Reserved marker collision must be handled explicitly. If a user object contains `__kkrpc_ref__` with a shape that could be confused with an envelope, encode it as normal user data using an escape wrapper before transport send, and unescape it on decode.

Decoding must be recursive and symmetrical with encoding. Every inbound request argument, setter value, constructor argument, response value, stream control value, stream chunk, and error custom field should pass through the recursive decoder so `RemoteRefEnvelope` leaves become callable proxies wherever they appear. The current shallow `decodeValue()` behavior is not sufficient.

### Remote Function Calls

A decoded function ref should become an async proxy function:

```ts
const result = await remoteFn(...args)
```

Calling it sends a normal request/response message, not a fire-and-forget callback. The caller should receive the callback return value or thrown error.

Protocol decision:

- Reuse the existing `RPCRequest` / `RPCResponse` message shapes.
- Add a dedicated internal operation, `op: "ref"`, to `RPCOperation`.
- Do not reserve or intercept a user-visible path such as `p: ["$ref", ...]` for wire routing. User APIs may continue to expose properties named `$ref` through normal `call` / `get` / `set` / `new` operations.

This keeps the request/response pipeline while avoiding user API path collisions.

Concrete routing decision:

```ts
{ t: "q", op: "ref", p: [refId, "apply"], a: encodedArgs }
```

`RPCChannel.handleRequest()` should recognize `op: "ref"` before `executeRequest()` enforces the exposed-API guard. This is required because a common `wrap()` client has no exposed local API but may still own function refs passed as callback arguments. Internal ref dispatch must be able to invoke those local refs without `this.expose`.

Plugin behavior for ref requests:

- `onRequest`, `onResponse`, and `onError` should still run so observability sees ref traffic.
- `wrapHandler` may run with a synthetic internal `localAPI` object when no user API is exposed, but validation and middleware plugins should ignore `operation: "ref"` unless explicitly designed for it.
- Plugin contexts should expose a synthetic method string such as `$ref.<refId>.apply` for diagnostics only; this string is not a user API path.

For function refs:

- `apply` invokes the locally retained function target.
- The receiver argument should be `undefined`; function refs do not implicitly bind to the original object unless the function target was explicitly bound by user code before export.
- Return values should be recursively encoded like any other RPC response.
- Thrown errors should use the existing response error path after recursive-safe error conversion.

The decoded remote function should be async from the caller's perspective. This changes current callback timing from fire-and-forget to awaitable, but does not block unrelated RPC messages because each ref call is an independent request id.

### Remote Object Proxies

Objects should be proxied only when explicit or policy-selected.

Provide an API:

```ts
import { proxy } from "kkrpc"

return proxy(new ToastHandle())
```

A decoded object ref should support:

- Property get.
- Property set.
- Method call.

Plain return objects remain by-value, so `return { ok: true, hide() {} }` should send `{ ok: true, hide: remoteFunctionRef }`; the object itself is cloned, and only `hide` is proxied.

Concrete object operations should use the same internal `ref` operation:

```ts
{ t: "q", op: "ref", p: [refId, "get", ...propertyPath] }
{ t: "q", op: "ref", p: [refId, "set", ...propertyPath], v: encodedValue }
{ t: "q", op: "ref", p: [refId, "call", ...propertyPath], a: encodedArgs }
```

Property keys should initially be string-only to match the existing `RPCRequest.p: string[]` path model. Dot characters are allowed because paths are arrays on the wire; dot-joined method strings are diagnostics only. Symbol-keyed remote properties are out of scope for the first implementation.

Decoded object proxies should handle JavaScript proxy ergonomics carefully:

- Root object proxies hide `then` to avoid accidental Promise assimilation. Nested property proxy nodes may use the existing root API pattern where `await proxy.property` triggers a `get` request for that property path.
- `releaseProxy`, `isRemoteProxy`, inspection symbols, and common function built-ins such as `bind`, `call`, and `apply` should not accidentally become remote property requests.
- Method calls on object proxies should bind `this` to the proxied target on the owner side by resolving the parent object and applying the method with that parent as receiver.
- Property access should be lazy: `proxy.a.b` creates local proxy nodes without network round trips, while `await proxy.a.b` sends one `get` request and `proxy.a.b()` sends one `call` request. This avoids one round trip per path segment.
- Assignment through the JavaScript `set` trap should match the existing root API behavior: schedule a set request and return `true`. Because assignment cannot return a promise, deterministic setter acknowledgement is not part of the initial object-proxy API.
- Constructor-like behavior should remain out of scope unless a future explicit `proxyConstructor()` API is added.

### Reference Registry

Each channel needs two registries:

- Local references exported to the remote side: `localRefs: Map<id, RefRecord>`.
- Remote proxy metadata received from the remote side: `remoteRefs: WeakMap<object, RemoteRefMetadata>`.

The module also needs a weak global proxy metadata registry so public helpers can work without access to a channel instance:

- Explicit local object proxy markers: `explicitProxyTargets: WeakSet<object>`.
- Decoded remote proxy metadata: `remoteProxyRegistry: WeakMap<object, RemoteProxyRecord>`.

`RefRecord` should track:

- `id`
- `kind`
- `target`
- `createdAt`
- `lastUsedAt`
- `refCount` or lease count if implemented
- `autoRelease` policy
- optional debug metadata such as first method path that exported it

The existing callback registry should be replaced or wrapped by this generic local reference registry.

Implementation detail:

```ts
type RefKind = "function" | "object"

interface RefRecord {
	id: string
	kind: RefKind
	target: unknown
	createdAt: number
	lastUsedAt: number
	createdBy?: string
	refCount?: number
	autoRelease?: boolean
	released: boolean
	explicit: boolean
}

interface RemoteRefMetadata {
	id: string
	kind: RefKind
	released: boolean
}

interface RemoteProxyRecord extends RemoteRefMetadata {
	release(): Promise<void>
	markReleased(): void
}
```

`localRefs` should retain targets exported to the remote. Channel-local `remoteRefs` should map decoded proxy objects/functions to metadata for channel cleanup. The module-level `remoteProxyRegistry` should map decoded proxy objects/functions to a release closure so `releaseProxy(value)` can send a release request for the right channel and ref id.

`proxy(value)` should use a module-level `WeakSet` marker, not an enumerable object property and not a wire-visible symbol. Unlike `transfer()`, the proxy marker is persistent rather than consumed on first encode; each channel uses its own `WeakMap<object, string>` to map marked values to local ref ids.

When a remote proxy is passed back to the side that created it, the encoder should preserve the original envelope rather than wrapping the proxy as a new local ref. This requires checking `remoteRefs` before checking local functions or explicit object proxy markers.

Identity goals are practical rather than global: repeated use of the same local function or explicit proxied object on one channel should reuse one local ref id when possible. A `WeakMap<object, string>` from exported target to local ref id is enough for functions and explicit proxied objects.

Initial release semantics should be id-based, not lease-count based: releasing a ref id marks that id released and removes its local target. `refCount` is diagnostic only unless a later design introduces explicit leases with increment/decrement rules.

### Cleanup And Release

Remote refs require deterministic release.

Public APIs:

```ts
releaseProxy(value): Promise<void>
isRemoteProxy(value): boolean
proxy(value): T
```

Supported cleanup paths:

- `releaseProxy(remoteValue)` sends a release message for one remote ref.
- `channel.destroy()` releases all local and remote refs and rejects pending ref calls.
- Optional follow-up: `FinalizationRegistry` registers decoded remote proxies and sends best-effort release when they are garbage-collected.
- One-shot refs can auto-release after the first successful remote call when explicitly marked.
- Long-lived subscription callbacks must not auto-release just because the original RPC call returned.

Do not auto-release every function argument after the enclosing RPC returns. This breaks subscription APIs where the remote side intentionally calls the callback later.

Recommended API for one-shot callbacks:

```ts
api.once(kkrpc.once((value) => value))
```

This can be a follow-up if the base reference system is already large.

Concrete release routing:

```ts
{ t: "q", op: "ref", p: [refId, "release"] }
```

Release should be idempotent. `releaseProxy(value)` should return a resolved promise for non-proxy values and already released remote proxies. For a live remote proxy, it should mark the local proxy as released immediately, send the release request, resolve when the release request is written/acknowledged, and reject on local transport write failure. Direct calls on a released ref should reject with a clear `RPCRemoteReferenceReleasedError` message containing the ref id.

`channel.destroy()` should:

- Mark decoded remote proxies as released locally so future calls reject immediately.
- Clear local refs so future remote calls into them fail with a released/unknown ref error if any late message arrives before transport close.
- Reject pending remote-ref calls through the same pending request map used for normal calls.
- Close streams as it does today.

When the optional finalizer phase is implemented, finalizer behavior should be guarded with feature detection and should never be required for correctness. If `FinalizationRegistry` exists, decoded remote proxies should register a held value containing only the remote ref id and channel identity, not the proxy object itself.

### Default Behavior

Remote references should be enabled by default for the main TypeScript entrypoints.

Channel options should still exist:

```ts
new RPCChannel(transport, {
	remoteRefs: true,
	remoteRefPolicy: "functions" | "off"
})
```

Recommended defaults:

- `remoteRefs: true`
- `remoteRefPolicy: "functions"`
- Explicit object proxying via `proxy(value)`
- No automatic DOM/Event object proxying

Interop or data-only users can set `remoteRefs: false` to retain strictly JSON-compatible behavior.

Recommended exact option semantics for this repo:

```ts
interface RPCChannelOptions {
	remoteRefs?: boolean
	remoteRefPolicy?: "functions" | "off"
}
```

Defaults:

- `remoteRefs: true`
- `remoteRefPolicy: "functions"`

Policy behavior:

- `"off"`: reject functions and explicit proxies during encoding with a clear error.
- `"functions"`: automatically export functions and allow objects only when marked with `proxy(value)`. This is the default.
- Future policy names such as `"auto-noncloneable"` should not be accepted until implemented. Passing an unknown policy should throw a clear configuration error.

Transport capability changes:

```ts
interface TransportCapabilities {
	remoteRefs?: boolean
}
```

- Bidirectional transports that can carry follow-up requests in either direction should set `remoteRefs: true`.
- Unary HTTP should set `remoteRefs: false` because it cannot carry remote callback/ref calls after the initial request/response.
- `RPCChannel` should reject attempts to encode function refs or explicit object refs before registering local refs when `remoteRefs` are disabled by channel option or transport capability.
- If encode or send fails after creating refs for the current message, the channel must roll back refs created during that message so failed sends do not retain closures until channel destruction.

HTTP transport should also reject remote-reference envelopes the same way it currently rejects callback and stream envelopes, because unary HTTP has no reverse channel for follow-up ref calls. Its unsupported-envelope scan should detect `__kkrpc_ref__`, stream refs, and any legacy callback envelopes in one recursive walker.

### Error Handling

Transport write failure must not leave callers waiting for timeout when avoidable.

Requirements:

- Outbound request write failure rejects the local pending request immediately.
- Response write failure should produce a local diagnostic and, if possible, send a minimal serializable error response instead of a successful response containing an uncloneable value.
- If even the minimal error response fails, log the failure through plugin hooks or a channel error hook.
- Timeout errors should include operation and method path, such as `call ui.showToast`.

Implementation detail:

- `request()` timeout messages should include operation and dot-joined path for both normal calls and internal `op: "ref"` calls.
- If response value encoding fails after a local handler succeeds, `handleRequest()` should send an error response for the original request id rather than allowing the caller to time out.
- If a transport write fails while sending that fallback error response, the failure should be routed through existing write-failure handling and plugin diagnostics where available.
- Encoding errors should include a value path such as `result.hide` or `args[0].onClick` when practical, so callers can find the unencodable field.
- Direct calls on released remote proxies should reject locally before sending when local metadata says the proxy is released.
- Error response payloads need explicit `encodeError()` / `decodeError()` handling. `RPCResponse.e` and stream error payloads should recursively encode enumerable custom fields after preserving `name`, `message`, and `stack`, then decode those custom fields on the receiver. This prevents a function stored on an error custom field from causing a structured-clone failure or arriving as an undecoded envelope.

### Observability Hooks

Existing plugin hooks should observe remote-ref calls as normal RPC calls where possible.

Additional attributes should be available to observability layers:

- `rpc.remote_ref.id`
- `rpc.remote_ref.kind`
- `rpc.remote_ref.operation`
- `rpc.remote_ref.created_by_method`
- `rpc.remote_ref.release_reason`

Do not log raw callback arguments or object contents by default.

Internal `op: "ref"` operations should still run through existing plugin hooks where practical. The plugin context should identify them with `operation: "ref"` and an internal diagnostic method path such as `$ref.<id>.apply` or `$ref.<id>.call.hide`. A future inspector plugin can convert these into the additional attributes above without requiring a second hook system.

## Compatibility

### Existing Function Arguments

Existing function argument callbacks should continue to work. Their behavior should improve because callback invocation can now return a value or reject.

Compatibility risk: existing callers may assume callbacks are fire-and-forget. Awaiting them internally can change timing. The implementation should not block unrelated RPC progress while waiting on callback results.

Wire protocol decision: new channels should stop emitting `RPCCallback` (`t: "cb"`) messages and should remove the callback registry as the primary callback mechanism. Source-level function arguments remain compatible because they encode as remote refs. The initial implementation should remove `RPCCallback` from the active `RPCMessage` protocol and `handleMessage()` dispatch. Receive-only legacy `t: "cb"` compatibility is out of scope unless a concrete external interop requirement is raised before release, in which case it must be designed and tested as a separate compatibility path.

### Existing Returned Data

Existing cloneable returned data should remain by-value and should not become proxied.

Returned functions that used to be dropped by JSON should become callable remote functions. This is a behavior improvement but may reveal previously hidden references.

### Validation

Validation plugins need clear semantics:

- Input validation should keep the current data-oriented behavior: callback/function arguments are filtered out before input schemas run.
- Output validation should validate user-level values before wire encoding and should not need to understand remote-ref envelopes.
- Internal `op: "ref"` calls should be skipped by the validation plugin unless a future plugin explicitly opts into remote-ref validation.

Current kkrpc validation already runs in plugin hooks after request decode and before response encode. This is the right behavior for normal user API calls. The existing validation plugin also intentionally filters callback/function arguments before input validation, both in runtime (`filterCallbacks`) and in types (`FilterCallbacks`). Remote refs should preserve that behavior for the initial implementation. If schema validation for function arguments is desired later, it should be a separate validation-plugin design change.

### Transferables

Transfer descriptors should continue to work. The recursive encoder must not consume transfer descriptors twice and must preserve zero-copy transfer behavior.

Transfer descriptors should be consumed at the highest encoded value carrying the descriptor. If the descriptor exists and transfer is supported, the encoder should return the descriptor's `value` and append descriptor transferables without recursively walking into that returned value. This preserves the existing one-shot transfer cache semantics.

If transfer is disabled, the descriptor must not be consumed, matching current behavior. The value then continues through normal recursive encoding.

Remote refs and transfer descriptors should not be mixed on the same object. If a value is both explicitly proxied and marked for transfer, encoding should reject with a clear error because by-reference and transfer-of-ownership are conflicting semantics.

The conflict check must happen before consuming the transfer descriptor. If a value is both in the explicit proxy marker set and has a transfer descriptor, the encoder should throw without calling `takeTransferDescriptor()`, so the transfer descriptor is not lost on a failed encode attempt.

## Security And Resource Risks

Primary risks:

- Memory leaks from retained closures and remote object refs.
- Privilege leaks when a high-privilege host object is accidentally proxied to a low-privilege plugin.
- Long-lived refs keeping large object graphs alive.
- Remote calls into released refs causing confusing errors.
- Finalizer-only cleanup being delayed indefinitely.

Mitigations:

- Default automatic proxying only for functions, not arbitrary objects.
- Require explicit `proxy(value)` for object/class instance refs.
- Provide `releaseProxy()` and channel-level cleanup.
- Add dev warnings for high ref counts, long-lived refs, and unreleased explicit object refs.
- Include method path metadata for where refs were created.
- Keep host/plugin permission checks on the receiving API side; remote refs must not bypass authorization.

## Testing Requirements

Core tests should cover:

- Nested returned function: `const handle = await api.create(); await handle.hide()`.
- Nested function in array/object/Map/Set.
- Function argument still works.
- Callback return value resolves to caller.
- Callback thrown error rejects caller.
- Passing a remote function proxy back to the side that created it preserves identity enough to call correctly.
- `releaseProxy()` makes future calls fail with a clear released-ref error.
- `destroy()` releases refs and rejects pending ref calls.
- If the optional FinalizationRegistry follow-up is implemented, its behavior should be covered with capability-gated tests or isolated unit tests that do not rely on nondeterministic GC for correctness.
- Structured clone transport no longer throws when returned data contains function leaves.
- Response write failure produces a method-rich error instead of an opaque timeout.
- Transferable objects still transfer zero-copy.
- Async iterable streaming still works.
- JSON-only mode with `remoteRefs: false` rejects function refs clearly.

Integration tests should cover:

- Worker parent/child round-trip of returned function refs.
- Electron or postMessage transport if available.
- Stdio JSON transport behavior with remote refs enabled.
- Browser bundle benchmark impact for default entry and worker entry.

Additional repo-specific tests:

- Core memory transport test for `{ hide() {} }` returned from a method and `await handle.hide()` returning a value.
- Core memory transport test for nested function leaves inside array, object, Map, Set, and Error custom fields.
- Core memory transport test for a callback argument returning a value and throwing an error.
- Core memory transport test for a callback passed from a `wrap()` client with no exposed API; the server awaits the callback result and the client-side ref dispatch must not fail with `No API exposed`.
- Core memory transport test for passing a decoded remote function back to its owner and invoking it without creating an extra wrapper ref.
- Core memory transport test for the same function repeated within one message, such as `{ a: fn, b: fn }`, reusing one remote ref id.
- Core memory transport test for concurrent calls to the same remote ref resolving independently.
- Core memory transport test for explicit `proxy(new ToastHandle())` object get/set/method call.
- Core memory transport test for `releaseProxy()` idempotency and clear failure on later calls.
- Core memory transport test for release while a ref call is pending and for remote channel destroy while a ref call is in flight.
- Worker test proving returned function leaves do not cause structured-clone `DataCloneError`.
- HTTP test proving remote-ref envelopes are rejected with an explicit unsupported-transport error.
- HTTP test proving failed/unsupported sends do not leave refs registered.
- Validation test proving callback/function arguments remain filtered from input schemas and `op: "ref"` calls are skipped by the validation plugin.
- Transfer test proving `transfer(buffer, [buffer])` still forwards exactly one transferable after recursive encoder changes.
- Async iterable regression proving stream refs still work when chunks contain remote function leaves.
- Protocol test proving a normal user API with a top-level `$ref` property still works because ref calls use `op: "ref"` instead of a reserved user path.
- Object proxy ergonomics tests for `then`, `bind`, `call`, `apply`, symbols, lazy property paths, assignment behavior, and method `this` binding.

## Acceptance Criteria

- A function nested anywhere inside a returned plain object can be called by the receiver and can return a value.
- A function nested anywhere inside call arguments can be called by the receiver and can return a value.
- Remote refs are cleaned up by `releaseProxy()` and `channel.destroy()`.
- Unreleased refs are diagnosable through debug metadata or warnings.
- Existing tests pass without requiring every existing API to become data-only.
- Worker structured-clone channels do not throw `DataCloneError` for encoded function refs.
- Non-function non-cloneable objects are not silently proxied unless explicitly marked or policy-enabled.
- User APIs with a top-level `$ref` property remain callable because remote-reference routing uses `op: "ref"`, not a reserved user path.
- Bundle-size impact is measured and documented. The initial implementation should target less than 5KB gzipped increase for the browser/core entry; exceeding that budget requires documenting the cause and trade-off.

Implementation is considered complete only when `pnpm --filter kkrpc check-types`, `pnpm --filter kkrpc test`, and the browser bundle comparison script have been run or a clear reason is documented for any command that cannot run in the local environment.

## Suggested Implementation Phases

0. Finalize protocol decisions in the spec: `op: "ref"`, no new `RPCCallback` emission, copy-on-write graph scope, transport `remoteRefs` capability, global proxy metadata, and validation behavior.
1. Add protocol envelopes, local/remote ref registries, recursive copy-on-write encode/decode for functions in acyclic plain objects/arrays, and request/response based remote function calls.
2. Add deterministic cleanup: `releaseProxy()`, `isRemoteProxy()`, `proxy()`, channel destroy cleanup, rollback for failed encode/send, and basic dev diagnostics.
3. Add explicit remote object proxy support for lazy get, set, and call as a separate phase or PR.
4. Add Map/Set container tests and any extra codec-specific handling needed for SuperJSON/string transports after the plain object/array path is stable.
5. Add FinalizationRegistry best-effort cleanup as an optional follow-up. It must not be required for correctness or tested through nondeterministic GC behavior.
6. Add one-shot callback helper if needed.
7. Add transport write-failure improvements and method-rich timeout/error messages if not already present.
8. Run bundle benchmark and document size impact.

For this repository, phases 0 through 3 are required for the approved full scope. Phase 4 is required only for the Map/Set goal. Phases 5 and 6 are optional follow-ups. Phase 7 should be partly incremental because write-failure handling already exists, but method-rich timeout and response-encoding-failure coverage still need to be added. Phase 8 is required before marking the feature complete.

## Notes From Kunkun Investigation

- Uniview fixed `PointerEvent` by sanitizing event handler arguments at the host-svelte boundary, not by changing codecs.
- Kunkun fixed `showToast` by changing host RPC to return `void`, because returning `{ hide: function }` was not cloneable.
- These remain valid product-level API design choices even after kkrpc gains remote refs. Remote refs should be available when needed, not a reason to expose host internals casually.
