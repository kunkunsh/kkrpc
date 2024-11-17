# kkrpc

> A TypeScript-first RPC library that enables seamless bi-directional communication between processes.
> Call remote functions as if they were local, with full TypeScript type safety and autocompletion support.

## Supported Environments

- stdio: RPC over stdio between any combinations of Node.js, Deno, Bun processes
- web: RPC over `postMessage` API and message channel between browser main thread and web workers, or main thread and iframe
  - Web Worker API (web standard) is also supported in Deno and Bun, the main thread can call functions in worker and vice versa.
- http: RPC over HTTP like tRPC
  - supports any HTTP server (e.g. hono, bun, nodejs http, express, fastify, deno, etc.)
- WebSocket: RPC over WebSocket

The core of **kkrpc** design is in `RPCChannel` and `IoInterface`.

- `RPCChannel` is the bidirectional RPC channel
- `LocalAPI` is the APIs to be exposed to the other side of the channel
- `RemoteAPI` is the APIs exposed by the other side of the channel, and callable on the local side
- `rpc.getAPI()` returns an object that is `RemoteAPI` typed, and is callable on the local side like a normal local function call.
- `IoInterface` is the interface for implementing the IO for different environments. The implementations are called adapters.
  - For example, for a Node process to communicate with a Deno process, we need `NodeIo` and `DenoIo` adapters which implements `IoInterface`. They share the same stdio pipe (`stdin/stdout`).
  - In web, we have `WorkerChildIO` and `WorkerParentIO` adapters for web worker, `IframeParentIO` and `IframeChildIO` adapters for iframe.

> In browser, import from `kkrpc/browser` instead of `kkrpc`, Deno adapter uses node:buffer which doesn't work in browser.

```ts
interface IoInterface {
	name: string
	read(): Promise<Buffer | Uint8Array | string | null> // Reads input
	write(data: string): Promise<void> // Writes output
}

class RPCChannel<
	LocalAPI extends Record<string, any>,
	RemoteAPI extends Record<string, any>,
	Io extends IoInterface = IoInterface
> {}
```

## Examplesr

Below are simple examples.

### Stdio Example

```ts
import { NodeIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api.ts"

const stdio = new NodeIo(process.stdin, process.stdout)
const child = new RPCChannel(stdio, apiMethods)
```

```ts
import { spawn } from "child_process"

const workerBun = spawn("bun", ["scripts/node-api.ts"])
const io = new NodeIo(worker.stdout, worker.stdin)
const parent = new RPCChannel<{}, API>(io, {})
const api = parent.getAPI()

expect(await api.add(1, 2)).toBe(3)
```

### Web Worker Example

```ts
import { RPCChannel, WorkerChildIO, type DestroyableIoInterface } from "kkrpc"

const worker = new Worker(new URL("./scripts/worker.ts", import.meta.url).href, { type: "module" })
const io = new WorkerChildIO(worker)
const rpc = new RPCChannel<API, API, DestroyableIoInterface>(io, apiMethods)
const api = rpc.getAPI()

expect(await api.add(1, 2)).toBe(3)
```

```ts
import { RPCChannel, WorkerParentIO, type DestroyableIoInterface } from "kkrpc"

const io: DestroyableIoInterface = new WorkerChildIO()
const rpc = new RPCChannel<API, API, DestroyableIoInterface>(io, apiMethods)
const api = rpc.getAPI()

const sum = await api.add(1, 2)
expect(sum).toBe(3)
```
