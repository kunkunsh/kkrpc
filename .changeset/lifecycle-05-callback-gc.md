---
"kkrpc": minor
---

Reclaim callbacks so a long-lived channel no longer leaks. Previously every function passed as a call argument stayed in the sender's callback registry until the channel was destroyed, so repeated callback use grew memory without bound. Now:

- The same function reused across calls shares one registry entry (dedup).
- On runtimes with `FinalizationRegistry`/`WeakRef`, when the peer's decoded callback facade is collected the owner is notified (new `t: "cbr"` protocol message) and drops the entry.
- New `releaseCallback(fn)` frees a decoded callback deterministically, mirroring `releaseProxy` from `kkrpc/remote-refs`; invoking a released callback throws the new `RPCCallbackReleasedError`.

The `cbr` message is ignored by peers that predate it, so this is backward compatible. See the new "Callback Lifecycle" guide.
