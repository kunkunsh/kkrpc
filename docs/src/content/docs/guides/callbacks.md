---
title: Callback Lifecycle
description: How kkrpc passes callbacks, reclaims them, and when to release them explicitly
sidebar:
  order: 8
---

The default `kkrpc` channel lets you pass functions as call arguments. This guide explains
how those callbacks are tracked, how they are reclaimed so a long-lived channel does not leak
memory, and when to release one explicitly.

## Passing a callback

When you pass a function as an argument, the sending channel keeps the function in a private
registry and sends a marker to the peer. When the peer invokes the marker, the call is routed
back and your function runs. The path is fire-and-forget — the return value and thrown errors
do not propagate back. Use [`kkrpc/remote-refs`](/guides/remote-references/) when you need
callback return values or error propagation.

```ts
// The receiver can call `onProgress` any number of times.
await remote.download(url, (percent) => console.log(percent))
```

## Automatic reclamation

The owner keeps a callback in its registry so the peer can invoke it later. On a long-lived
channel this would grow without bound if entries were never removed. kkrpc reclaims them two ways:

- **Deduplication.** Passing the *same* function reference more than once reuses a single
  registry entry, so `remote.on(handler)` called repeatedly with the same `handler` does not grow
  the registry. Note that a fresh inline arrow (`() => ...`) or a new `fn.bind(...)` is a distinct
  function each time and gets its own entry — those still rely on garbage collection below.
- **Garbage collection.** On runtimes with `FinalizationRegistry` and `WeakRef` (all current
  browsers, Node, Deno, Bun), when the peer's decoded callback facade is collected, the peer
  notifies the owner and the owner drops the registry entry. On runtimes without those
  primitives, automatic reclamation is unavailable and you should release callbacks explicitly.

## Releasing a callback explicitly

`releaseCallback()` deterministically frees a decoded callback, mirroring `releaseProxy()` from
`kkrpc/remote-refs`. Use it when you want to free the owner's entry immediately instead of waiting
for GC, or on runtimes without `FinalizationRegistry`.

```ts
import { releaseCallback } from "kkrpc"

function onEvent(payload: unknown) {
	/* ... */
}

await remote.subscribe(onEvent)
// Later, when you no longer need it:
releaseCallback(onEvent)
```

`releaseCallback()` is idempotent and returns `false` for values that are not callback facades.
Invoking a callback after it has been released throws `RPCCallbackReleasedError`.

## The release race

Releases are best-effort. There is a brief window in which the owner has a message in flight that
references a callback id, the peer collects its facade and asks the owner to release that id, and
the owner drops it before the in-flight message is decoded. A callback invoked in that window is
dropped rather than delivered — the same outcome as invoking a callback after the channel is
destroyed. The situation is self-healing: the next time you pass the same function it is registered
again under a fresh id. If you require every invocation to be delivered, keep a stable reference to
the callback and release it explicitly when you are done, rather than relying on GC timing.
