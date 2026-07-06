---
"kkrpc": minor
---

Error observability and defensive limits:

- New `onUncaughtError` channel option surfaces errors from fire-and-forget paths that were previously swallowed: a failed remote `set` (`kind: "set"`) and a thrown/rejected remote-callback invocation (`kind: "callback"`).
- Recursive value traversal (remote-ref encode/decode, HTTP envelope scanning, relay transferable collection) is now bounded to a maximum nesting depth (256), so pathologically deep inputs are rejected instead of overflowing the stack.
- The iframe child `MessagePort` handshake now uses exponential backoff (capped at 1s) instead of a fixed 25ms retry loop, and gives up after `handshakeTimeoutMs` (default 30s), firing `onClose` and rejecting `iframeChildTransportReady()` instead of retrying forever.
