---
title: stdio
description: IPC over stdio between JavaScript/TypeScript processes
---

`kkRPC` supports bidirectional IPC over newline-delimited JSON on stdio. Use `nodeStdioTransport()` inside a Node-compatible child process and `stdioJsonTransport()` when wiring explicit readable/writable streams from the parent.

```ts title="api.ts"
export interface API {
	add(a: number, b: number): Promise<number>
	greet(name: string): Promise<string>
}

export const apiMethods: API = {
	add: async (a, b) => a + b,
	greet: async (name) => `Hello, ${name}!`
}
```

## Child Process

```ts title="child.ts"
import { RPCChannel } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"
import { apiMethods } from "./api"

const channel = new RPCChannel(nodeStdioTransport(), { expose: apiMethods })

process.on("SIGINT", () => channel.destroy())
```

## Parent Process

```ts title="main.ts"
import { spawn } from "node:child_process"
import { RPCChannel } from "kkrpc"
import { stdioJsonTransport } from "kkrpc/stdio"
import type { API } from "./api"

const child = spawn("node", ["child.js"], { stdio: ["pipe", "pipe", "inherit"] })
const transport = stdioJsonTransport({
	readable: child.stdout!,
	writable: child.stdin!
})

const channel = new RPCChannel<object, API>(transport)
const api = channel.getAPI()

console.log(await api.add(1, 2))
console.log(await api.greet("stdio"))

channel.destroy()
await transport.close?.()
```

Any runtime can participate if it can read and write the same JSON-line protocol on stdio.
