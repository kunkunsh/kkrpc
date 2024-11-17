# `stdio` Demo

`api.ts`

`kkRPC` supports bidirectional IPC between Node.js/Bun and Deno. Callbacks (only when callbacks are top-level parameters) and nested objects are also supported.

```ts
export interface API {
	add(a: number, b: number): Promise<number>
	addCallback(a: number, b: number, callback: (result: number) => void): void
	math: {
		grade1: {
			add(a: number, b: number, callback?: (result: number) => void): Promise<number>
		}
	}
}

// Define your API methods
export const apiMethods: API = {
	add: async (a: number, b: number) => a + b,
	addCallback: async (a: number, b: number, callback?: (result: number) => void) => {
		callback?.(a + b)
	},
	math: {
		grade1: {
			add: async (a: number, b: number, callback?: (result: number) => void) => {
				callback?.(a + b)
				return a + b
			}
		}
	}
}
```

## IPC between 2 Node.js/Bun processes

`node-api.ts`

```ts
import { NodeIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api.ts"

const stdio = new NodeIo(process.stdin, process.stdout)
const child = new RPCChannel(stdio, apiMethods)
```

`main.ts`

```ts
import { spawn } from "child_process"

const worker = spawn("bun", ["scripts/node-api.ts"])
const io = new NodeIo(worker.stdout, worker.stdin)
const parent = new RPCChannel<{}, API>(io, {})
const api = parent.getAPI()

expect(await api.add(1, 2)).toBe(3)
```

## IPC between Node.js and Deno

`deno-api.ts`

```ts
import { DenoIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api.ts"

const io = new DenoIo(Deno.stdin.readable, Deno.stdout.writable)
const child = new RPCChannel(io, apiMethods)
```

`main.ts`

```ts
import { spawn } from "child_process"

const worker = spawn("deno", [path.join(testsPath, "scripts/deno-api.ts")])
const io = new NodeIo(worker.stdout, worker.stdin)
const parent = new RPCChannel<{}, API>(io, {})
const api = parent.getAPI()

expect(await api.add(1, 2)).toBe(3)
```
