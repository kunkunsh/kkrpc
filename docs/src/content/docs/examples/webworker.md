---
title: WebWorker
description: Bidirectional communication between main thread and WebWorker
---

`kkRPC` supports bidirectional RPC communication between the main thread and WebWorker.

For JS/TS runtime that supports web `WebWorker` standard, like Bun and Deno, this will also work.

It's better to run the example project located in `examples/iframe-worker-demo`.

```ts title="api.ts"
export interface API {
	add(a: number, b: number): Promise<number>
	addCallback(a: number, b: number, callback: (result: number) => void): void
	math: {
		grade1: {
			add(a: number, b: number, callback?: (result: number) => void): Promise<number>
		}
	}
}

export interface API2 {
	subtract(a: number, b: number): Promise<number>
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

export const apiMethods2: API2 = {
	subtract: async (a: number, b: number) => a - b
}
```

The main thread and worker thread can call each other's methods.

```ts title="main.ts"
const worker = new Worker(new URL("./worker.ts", import.meta.url).href, {
	type: "module"
})
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel<API, API2, DestroyableIoInterface>(io, apiMethods)
const api = rpc.getAPI()
const sum = await api.math.grade1.add(2, 3)
expect(sum).toBe(5)

...
io.destroy()
```

```ts title="worker.ts"
import { RPCChannel, WorkerChildIO, type DestroyableIoInterface } from "kkrpc"
import { apiMethods, type API } from "./api.ts"

const io: DestroyableIoInterface = new WorkerChildIO()
const rpc = new RPCChannel<API2, API, DestroyableIoInterface>(io, apiMethods2)
const api = rpc.getAPI()
const sum = await api.subtract(2, 3)
expect(sum).toBe(-1)
```
