---
title: Per-Call Options
description: Override timeout and cancel individual calls with withCallOptions
sidebar:
  order: 10
---

The channel-level `timeout` applies to every call. When a few calls need a different timeout — or
need to be cancelable — derive a proxy with `withCallOptions()` instead of changing the whole
channel.

## Overriding timeout

```ts
import { wrap, withCallOptions } from "kkrpc"

const api = wrap<RemoteAPI>(transport) // channel timeout, e.g. 30s
const quick = withCallOptions(api, { timeout: 2000 })

await api.normalCall() // uses the channel timeout
await quick.slowCall() // rejects after 2s with an RPCTimeoutError
```

The options apply to every call made through the returned proxy and any nested property proxies
derived from it. The original proxy is unchanged. Pass `timeout: 0` to disable the timeout for a
particular proxy.

This replaces the pattern of setting one large channel-wide timeout to accommodate a few
long-running methods: keep the channel default tight, and widen only the calls that need it.

## Canceling a call

Pass an `AbortSignal` to cancel an in-flight call. The returned promise rejects with an
`AbortError`, and if the signal is already aborted the call rejects immediately without sending
anything.

```ts
const controller = new AbortController()
const cancelable = withCallOptions(api, { signal: controller.signal })

const promise = cancelable.longRunning()
controller.abort() // promise rejects with AbortError

// Combine with a timeout signal:
withCallOptions(api, { signal: AbortSignal.timeout(5000) })
```

Canceling stops the caller from waiting; it does not abort work already running on the remote side.
Both `kkrpc/streaming` and `kkrpc/remote-refs` proxies support `withCallOptions`.
