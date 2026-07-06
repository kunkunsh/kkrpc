# kkrpc

## 2.1.0

### Minor Changes

- 4a9fe98: `createTransport()` now accepts an optional `onInvalidFrame(wire, error)` callback. When provided, wire values that `codec.decode()` cannot parse are reported to it and dropped instead of throwing into the platform's receive loop — matching the robustness the stdio transport already had for transports that may carry non-kkrpc or malformed frames. Without the option, behavior is unchanged.
- d854f82: Reclaim callbacks so a long-lived channel no longer leaks. Previously every function passed as a call argument stayed in the sender's callback registry until the channel was destroyed, so repeated callback use grew memory without bound. Now:

  - The same function reused across calls shares one registry entry (dedup).
  - On runtimes with `FinalizationRegistry`/`WeakRef`, when the peer's decoded callback facade is collected the owner is notified (new `t: "cbr"` protocol message) and drops the entry.
  - New `releaseCallback(fn)` frees a decoded callback deterministically, mirroring `releaseProxy` from `kkrpc/remote-refs`; invoking a released callback throws the new `RPCCallbackReleasedError`.

  The `cbr` message is ignored by peers that predate it, so this is backward compatible. See the new "Callback Lifecycle" guide.

- dce05c8: Detect dropped connections so pending calls fail fast instead of hanging until timeout. `Transport` and `Platform` gain an optional `onClose(listener)` hook, and `RPCChannel` gains an `onClose` option:

  - When a transport reports the connection closed, the channel rejects all pending requests immediately with the new `RPCTransportClosedError` (its `cause` carries the transport reason) and fails subsequent requests fast. The channel is not destroyed — reconnect by creating a new transport and channel.
  - `StreamingRPCChannel` also fails parked stream consumers and pending stream controls.
  - The WebSocket transports (`kkrpc/ws`, `webSocketClientTransport`) now report close/error. A local `close()` does not fire `onClose`.
  - `stdioPlatform`/`stdioJsonTransport` accept an optional `lifecycle` source; `nodeStdioTransport` wires it automatically on the default `process.stdin`.
  - `relayTransport` accepts options to auto-dispose when a side closes and optionally close the other side.

  Transports without `onClose` behave exactly as before. See the new "Connection Lifecycle" guide.

- 4e00cb6: Add `withCallOptions(api, { timeout, signal })` to derive a remote proxy whose calls use a per-call timeout and/or `AbortSignal`, without changing the channel default. Overriding a few slow methods no longer requires widening the whole channel timeout, and calls become individually cancelable — an aborted signal rejects the in-flight call with an `AbortError` (and rejects immediately, without sending, if already aborted). Works on the default, streaming, and remote-ref channels.
- 9dc4c14: Error observability and defensive limits:

  - New `onUncaughtError` channel option surfaces errors from fire-and-forget paths that were previously swallowed: a failed remote `set` (`kind: "set"`) and a thrown/rejected remote-callback invocation (`kind: "callback"`).
  - Recursive value traversal (remote-ref encode/decode, HTTP envelope scanning, relay transferable collection) is now bounded to a maximum nesting depth (256), so pathologically deep inputs are rejected instead of overflowing the stack.
  - The iframe child `MessagePort` handshake now uses exponential backoff (capped at 1s) instead of a fixed 25ms retry loop, and gives up after `handshakeTimeoutMs` (default 30s), firing `onClose` and rejecting `iframeChildTransportReady()` instead of retrying forever.

### Patch Changes

- f60b1fe: Mark the package as side-effect free (`"sideEffects": false`). kkrpc's source has no import-time side effects, so this lets downstream bundlers drop unused re-export modules. The browser entry's module count drops with no change to the core bundle size.
- 8388e18: Consolidate the three duplicated `generateId` helpers into `core/utils.ts` and harden the no-`crypto.randomUUID` fallback with a process-monotonic counter, so a channel never reuses an id for two live requests even on runtimes without `crypto` and when the clock and `Math.random()` collide.
- 97e8963: Report `objectMode` truthfully on the JSON-string transports (`ws`, `web-socket-client`, `ws/hono`, `ws/elysia`, `http`), which serialize with `JSON.stringify` and therefore cannot preserve non-JSON values like `Date` or `Map`. They now advertise `objectMode: false`. Structured-clone transports (`worker`, `iframe`) and Socket.IO's own serializer keep `objectMode: true`. Documented that `objectMode` and `broadcast` are informational — the core branches only on `transfer` and `remoteRefs`.

## 2.0.0

### Major Changes

- Keep the default `kkrpc` entry slim by moving streaming support to `kkrpc/streaming` and explicit remote references to `kkrpc/remote-refs`.
- Require explicit `proxy()` markers for remote references and reject unmarked function values instead of implicitly proxying them.
- Tighten HTTP and message-bus feature boundaries with clearer errors for unsupported callback, stream, and remote-reference envelopes.

## 0.4.0

### Minor Changes

- Add support for property access and error preservation

## 0.1.0

### Minor Changes

- Support Uin8Array and stdout passthrough
