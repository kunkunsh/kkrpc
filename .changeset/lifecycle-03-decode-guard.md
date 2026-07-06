---
"kkrpc": minor
---

`createTransport()` now accepts an optional `onInvalidFrame(wire, error)` callback. When provided, wire values that `codec.decode()` cannot parse are reported to it and dropped instead of throwing into the platform's receive loop — matching the robustness the stdio transport already had for transports that may carry non-kkrpc or malformed frames. Without the option, behavior is unchanged.
