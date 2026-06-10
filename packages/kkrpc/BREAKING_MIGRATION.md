# Breaking Migration

The stable `kkrpc` entry now uses the native `Transport<RPCMessage>` architecture. Classic `IoInterface`, `IoMessage`, `RPCValidators`, `RPCInterceptor`, `classic-compat`, `next/io`, `browser-lite`, `browser-mini`, and `electron-ipc` public entries were removed in the next2main migration.

The canonical migration guide is maintained in the docs site:

- Source: `docs/src/content/docs/guides/migration-1-0.md`
- Published URL: <https://docs.kkrpc.kunkun.sh/guides/migration-1-0/>

Use stable native imports for new code:

```ts
import { expose, wrap } from "kkrpc"
import { workerTransport } from "kkrpc/worker"
import { validationPlugin } from "kkrpc/validation"
```

Runtime transports and optional peer dependencies live behind subpaths such as `kkrpc/worker`, `kkrpc/stdio`, `kkrpc/ws`, `kkrpc/http`, `kkrpc/electron`, `kkrpc/tauri`, `kkrpc/socketio`, `kkrpc/rabbitmq`, `kkrpc/kafka`, `kkrpc/redis-streams`, and `kkrpc/nats`.
