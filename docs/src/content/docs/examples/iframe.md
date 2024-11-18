---
title: iframe
description: Bidirectional communication between main thread and iframe
---

`kkRPC` supports bidirectional RPC communication between the main thread and iframe.

Here is a real example from the repo. It's better to run the example project located in `examples/iframe-worker-demo`.

### API Definition

```ts title="api.ts"
export type API = {
	echo: (message: string, callback?: (echo: string) => void) => Promise<string>
	add: (a: number, b: number, callback?: (sum: number) => void) => Promise<number>
}

export const apiImplementation: API = {
	echo: (message, callback) => {
		callback?.(message)
		return Promise.resolve(message)
	},
	add: (a, b, callback) => {
		callback?.(a + b)
		return Promise.resolve(a + b)
	}
}

export type APINested = {
	echo: (message: string, callback?: (echo: string) => void) => Promise<string>
	math: {
		grade1: {
			add: (a: number, b: number, callback?: (sum: number) => void) => Promise<number>
		}
		grade2: {
			multiply: (a: number, b: number, callback?: (product: number) => void) => Promise<number>
		}
		grade3: {
			divide(a: number, b: number, callback?: (result: number) => void): Promise<number>
		}
	}
}

export const apiImplementationNested: APINested = {
	echo: (message, callback) => {
		callback?.(message)
		return Promise.resolve(message)
	},
	math: {
		grade1: {
			add: (a, b, callback) => {
				callback?.(a + b)
				return Promise.resolve(a + b)
			}
		},
		grade2: {
			multiply: (a, b, callback) => {
				callback?.(a * b)
				return Promise.resolve(a * b)
			}
		},
		grade3: {
			divide: (a, b, callback) => {
				callback?.(a / b)
				if (b === 0) {
					throw new Error("Division by zero")
				}
				return Promise.resolve(a / b)
			}
		}
	}
}
```

### Main Page

```svelte title="+page.svelte"
<script lang="ts">
	import { IframeParentIO, RPCChannel, type DestroyableIoInterface } from "kkrpc/browser"
	import { onDestroy, onMount } from "svelte"
	import { toast } from "svelte-sonner"
	import { apiImplementation, type API, type APINested } from "./api"

	let iframeRef: HTMLIFrameElement
	let io: IframeParentIO | undefined
	let rpc: RPCChannel<API, APINested, DestroyableIoInterface>

	function onDestroyClicked(e: MouseEvent) {
		rpc.getIO().destroy()
		toast.warning("Channel Destroyed", {
			description: "API Calls won't work anymore"
		})
	}

	async function onIframeLoad() {
		if (!iframeRef.contentWindow) return
		io = new IframeParentIO(iframeRef.contentWindow)
		rpc = new RPCChannel<API, APINested, DestroyableIoInterface>(io, { expose: apiImplementation })
	}

	function onMultiplyClicked(e: MouseEvent) {
		const api = rpc.getAPI()
		const randInt1 = Math.floor(Math.random() * 100)
		const randInt2 = Math.floor(Math.random() * 100)
		api.math.grade2
			.multiply(randInt1, randInt2, (product) => {
				toast.success("math.grade2.multiply run in iframe (callback)", {
					description: `${randInt1} * ${randInt2} = ${product}`
				})
			})
			.then((product) => {
				toast.success("math.grade2.multiply run in iframe", {
					description: `${randInt1} * ${randInt2} = ${product}`
				})
			})
	}

	onMount(() => {})
	onDestroy(() => {
		io?.destroy()
	})
</script>

<div class="space-y-2">
	<h1 class="text-2xl font-bold">Playground</h1>
	<div>
		<button class="btn" onclick={onDestroyClicked}>Destroy Channel</button>
		<button class="btn" onclick={onMultiplyClicked}>math.grade2.multiply in iframe</button>
	</div>
	<main class="h-96">
		<iframe
			bind:this={iframeRef}
			onload={onIframeLoad}
			src="/iframe"
			title="iframe"
			class="h-full w-full rounded-lg border border-blue-600"
		></iframe>
	</main>
</div>
```

### Iframe Page

```ts title="iframe/+page.svelte"
<script lang="ts">
	import { apiImplementationNested, type API, type APINested } from "./api.ts"
	import { IframeChildIO, RPCChannel, type DestroyableIoInterface } from "kkrpc/browser"
	import { onDestroy, onMount } from "svelte"
	import { toast } from "svelte-sonner"

	const io = new IframeChildIO(),
		rpc = new RPCChannel<APINested, API, DestroyableIoInterface>(io, { expose: apiImplementationNested })

	onMount(() => {})
	onDestroy(() => {
		io.destroy()
	})

	function onClick(e: MouseEvent) {
		const api = rpc.getAPI()
		const randInt1 = Math.floor(Math.random() * 100),
			randInt2 = Math.floor(Math.random() * 100)
		api
			.add(randInt1, randInt2, (sum) => {
				toast.info(`api.add run in main thread (callback)`, {
					description: `${randInt1} + ${randInt2} = ${sum}`
				})
			})
			.then((sum) => {
				toast.info(`api.add run in main thread`, {
					description: `${randInt1} + ${randInt2} = ${sum}`
				})
			})
	}
</script>

<div class="card bg-base-100 w-96 text-white shadow-xl">
	<div class="card-body">
		<h2 class="card-title">Iframe</h2>
		<button class="btn" onclick={onClick}>Run Add in Main Thread</button>
	</div>
</div>

```
