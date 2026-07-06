---
"kkrpc": minor
---

Detect dropped connections so pending calls fail fast instead of hanging until timeout. `Transport` and `Platform` gain an optional `onClose(listener)` hook, and `RPCChannel` gains an `onClose` option:

- When a transport reports the connection closed, the channel rejects all pending requests immediately with the new `RPCTransportClosedError` (its `cause` carries the transport reason) and fails subsequent requests fast. The channel is not destroyed — reconnect by creating a new transport and channel.
- `StreamingRPCChannel` also fails parked stream consumers and pending stream controls.
- The WebSocket transports (`kkrpc/ws`, `webSocketClientTransport`) now report close/error. A local `close()` does not fire `onClose`.
- `stdioPlatform`/`stdioJsonTransport` accept an optional `lifecycle` source; `nodeStdioTransport` wires it automatically on the default `process.stdin`.
- `relayTransport` accepts options to auto-dispose when a side closes and optionally close the other side.

Transports without `onClose` behave exactly as before. See the new "Connection Lifecycle" guide.
