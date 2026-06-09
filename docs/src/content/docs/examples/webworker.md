---
title: WebWorker
description: Bidirectional communication between main thread and WebWorker
---

`kkRPC` supports bidirectional RPC communication between the main thread and a Web Worker through native worker transports.

```ts title="api.ts"
export interface WorkerAPI {
	math: {
		add(a: number, b: number): Promise<number>
	}
}

export const workerApi: WorkerAPI = {
	math: {
		add: async (a, b) => a + b
	}
}
```

```ts title="main.ts"
import { wrap } from "kkrpc"
import { workerTransport } from "kkrpc/worker"
import type { WorkerAPI } from "./api"

const worker = new Worker(new URL("./worker.ts", import.meta.url).href, { type: "module" })
const api = wrap<WorkerAPI>(workerTransport(worker))

console.log(await api.math.add(2, 3))
```

```ts title="worker.ts"
import { expose } from "kkrpc"
import { workerSelfTransport } from "kkrpc/worker"
import { workerApi } from "./api"

expose(workerApi, workerSelfTransport())
```
