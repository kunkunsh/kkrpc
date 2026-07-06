---
"kkrpc": patch
---

Report `objectMode` truthfully on the JSON-string transports (`ws`, `web-socket-client`, `ws/hono`, `ws/elysia`, `http`), which serialize with `JSON.stringify` and therefore cannot preserve non-JSON values like `Date` or `Map`. They now advertise `objectMode: false`. Structured-clone transports (`worker`, `iframe`) and Socket.IO's own serializer keep `objectMode: true`. Documented that `objectMode` and `broadcast` are informational — the core branches only on `transfer` and `remoteRefs`.
