---
title: Connection Lifecycle
description: Detecting dropped connections, failing fast, and reconnecting
sidebar:
  order: 8
---

Long-lived transports — WebSockets, child-process stdio — can lose their connection at any time.
This guide covers how kkrpc surfaces that so pending calls fail immediately instead of hanging until
their timeout, and how to reconnect.

## `Transport.onClose`

A transport may implement an optional `onClose` hook:

```ts
onClose?(listener: (reason?: Error) => void): () => void
```

It fires **at most once**, when the connection permanently stops delivering messages because it
dropped — a remote close or a network error. `reason` is an `Error` for abnormal termination and
`undefined` for a clean remote close. It is **not** fired for a local `close()` (including the one
triggered by `channel.destroy()`), because that is intentional teardown, not a lost connection —
firing it there would make reconnect logic loop on normal shutdown.

The WebSocket transports (`kkrpc/ws`) implement `onClose`. The stdio transport implements it when
you provide a lifecycle source (see below); `nodeStdioTransport()` wires it automatically when it
uses the default `process.stdin`. Transports that do not implement `onClose` behave as before:
pending requests resolve, time out, or wait for `destroy()`.

## Channel behavior on close

Pass `onClose` to the channel to be notified, and rely on kkrpc to reject in-flight work:

```ts
import { wrap, RPCTransportClosedError } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"

const channel = new RPCChannel(webSocketClientTransport({ url }), {
	onClose: (reason) => console.warn("connection lost:", reason)
})
```

When the transport reports a close, the channel:

- rejects every pending request immediately with `RPCTransportClosedError` (its `cause` is the
  transport reason), so callers stop waiting for the timeout;
- fails subsequent requests fast with the same error;
- invokes your `onClose` handler;
- does **not** destroy itself — the exposed API, plugins, and callback registry stay intact.

`RPCTransportClosedError` requires a lifecycle-capable transport. On a transport without `onClose`,
the channel never sees a close and pending calls fall back to timing out.

## Reconnecting

kkrpc does not reconnect for you, because reconnection policy (backoff, attempt caps, whether to
resend in-flight calls) is application-specific. The recipe is to build a fresh transport and a
fresh channel:

```ts
function connect() {
	const transport = webSocketClientTransport({ url })
	const channel = new RPCChannel(transport, {
		onClose: () => {
			channel.destroy()
			setTimeout(connect, reconnectDelayMs)
		}
	})
	return channel
}
```

## stdio lifecycle

`stdioPlatform` and `stdioJsonTransport` accept an optional `lifecycle` source — usually the same
object as `readable` — whose `close`/`end`/`error` events drive `onClose`:

```ts
import { stdioJsonTransport } from "kkrpc/stdio"

const transport = stdioJsonTransport({ readable, writable, lifecycle: readable })
```

`nodeStdioTransport()` sets this up for you when reading from the default `process.stdin`; pass a
custom `lifecycle` when you supply your own readable.

## Relaying

`relayTransport()` auto-disposes when either side closes (a closed side cannot forward), and takes
optional lifecycle handling:

```ts
import { relayTransport } from "kkrpc/relay"

relayTransport(left, right, {
	closeOtherSide: true,
	onClose: (side, reason) => console.log(`${side} closed`, reason)
})
```

## Transport support matrix

| Transport | `onClose` |
| --- | --- |
| `kkrpc/ws` (`webSocketTransport`, `webSocketClientTransport`) | Yes |
| `kkrpc/stdio` (with `lifecycle`, or `nodeStdioTransport` on default stdin) | Yes |
| Others (worker, iframe, electron, chrome-extension, bus transports, http) | Not yet — pending requests time out or wait for `destroy()` |
