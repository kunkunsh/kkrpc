---
transition: slide-left
---

# Quick Example

## Node.js to Deno via stdio

````md magic-move {lines: true}
```ts
// api.ts - Shared API definition
export type API = {
	add(a: number, b: number): Promise<number>
	greet(name: string): Promise<string>
}
```

```ts
// server.ts - Deno process
import { DenoIo, RPCChannel } from "kkrpc"
import type { API } from "./api.ts"

const api: API = {
	add: (a, b) => Promise.resolve(a + b),
	greet: (name) => Promise.resolve(`Hello, ${name}!`)
}

const io = new DenoIo(Deno.stdin.readable)
const rpc = new RPCChannel(io, { expose: api })
```

```ts
// client.ts - Node.js process
import { spawn } from "child_process"
import { NodeIo, RPCChannel } from "kkrpc"
import type { API } from "./api.ts"

const worker = spawn("deno", ["run", "server.ts"])
const io = new NodeIo(worker.stdout, worker.stdin)
const rpc = new RPCChannel<{}, API>(io)
const api = rpc.getAPI()

// Type-safe calls!
console.log(await api.add(2, 3)) // 5
console.log(await api.greet("World")) // Hello, World!
```
````

<!--
Here's a complete example showing Node.js talking to Deno via stdio.

First, define your API types. Then implement on the server side - this is Deno exposing the API.

On the client side - Node.js spawns the Deno process and gets a fully typed API proxy.

That's it. No boilerplate, no handlers, just type-safe function calls.
-->
