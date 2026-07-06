---
"kkrpc": minor
---

Add `withCallOptions(api, { timeout, signal })` to derive a remote proxy whose calls use a per-call timeout and/or `AbortSignal`, without changing the channel default. Overriding a few slow methods no longer requires widening the whole channel timeout, and calls become individually cancelable — an aborted signal rejects the in-flight call with an `AbortError` (and rejects immediately, without sending, if already aborted). Works on the default, streaming, and remote-ref channels.
