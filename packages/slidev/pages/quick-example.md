---
transition: slide-left
---

# Quick Example

## Node.js child process via stdio

````md magic-move {lines: true}
```ts
// api.ts - Shared API definition
export type API = {
	add(a: number, b: number): Promise<number>
	greet(name: string): Promise<string>
}
```

```ts
// server.ts - child process
import { RPCChannel } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"
import type { API } from "./api.ts"

const api: API = {
	add: (a, b) => Promise.resolve(a + b),
	greet: (name) => Promise.resolve(`Hello, ${name}!`)
}

const rpc = new RPCChannel(nodeStdioTransport(), { expose: api })
```

```ts
// client.ts - Node.js process
import { spawn } from "node:child_process"
import { RPCChannel } from "kkrpc"
import { stdioJsonTransport } from "kkrpc/stdio"
import type { API } from "./api.ts"

const worker = spawn("node", ["server.js"], { stdio: ["pipe", "pipe", "inherit"] })
const transport = stdioJsonTransport({
	readable: worker.stdout!,
	writable: worker.stdin!
})
const rpc = new RPCChannel<object, API>(transport)
const api = rpc.getAPI()

// Type-safe calls!
console.log(await api.add(2, 3)) // 5
console.log(await api.greet("World")) // Hello, World!
```
````

<!--
Here's a complete example showing Node.js talking to a child process via stdio.

First, define your API types. Then implement on the server side - this is the child process exposing the API.

On the client side - Node.js spawns the process and gets a fully typed API proxy.

That's it. No boilerplate, no handlers, just type-safe function calls.
-->
