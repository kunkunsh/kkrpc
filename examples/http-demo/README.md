# HTTP Demo

This is a demo for testing the native unary HTTP transport across different HTTP servers.

Servers expose the API with `createHttpHandler` from `kkrpc/http`:

```ts
import { apiImplementationNested } from "@kksh/demo-api"
import { createHttpHandler } from "kkrpc/http"

const handler = createHttpHandler(apiImplementationNested)
```

Clients use the stable core `wrap` helper with `httpClientTransport`:

```ts
import { wrap } from "kkrpc"
import { httpClientTransport } from "kkrpc/http"

const api = wrap(httpClientTransport({ url: "http://127.0.0.1:3000/rpc" }))
```

## Manual Testing

### Install Dependencies

```sh
pnpm install
```

### Start One Server

Run one server in terminal 1. Each command exposes the same RPC API over a different HTTP runtime or framework:

```bash
pnpm run hono
pnpm run express
pnpm run bun
pnpm run http
pnpm run fastify
pnpm run deno
```

### Start The Client

Run the client in terminal 2:

```bash
pnpm run client
```

The client defaults to `http://127.0.0.1:3000/rpc`. This avoids accidentally resolving `localhost` to another IPv6 dev server. To test a different URL:

```bash
KKRPC_HTTP_URL=http://127.0.0.1:3000/rpc pnpm run client
```

### What To Verify

- The server terminal should stay running without throwing.
- The client should connect to `http://127.0.0.1:3000` and print successful RPC call output.
- Repeat the client command against each server implementation if you want to compare HTTP runtimes.

### Troubleshooting

- Only run one server command at a time because they use the same port.
- If the client cannot connect, stop the old server process and start the server variant you want to test.
- If another local dev server is using `localhost:3000`, keep using `127.0.0.1` or set `KKRPC_HTTP_URL` explicitly.

### Regression Test

```bash
pnpm test
```

This starts an ephemeral HTTP RPC server and runs the client flow against it.
