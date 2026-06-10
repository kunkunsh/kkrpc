---
title: iframe
description: Bidirectional communication between main thread and iframe
---

`kkRPC` supports bidirectional RPC communication between a page and an iframe through native iframe transports.

```ts title="api.ts"
export type FrameAPI = {
	math: {
		multiply(a: number, b: number): Promise<number>
	}
}

export const frameApi: FrameAPI = {
	math: {
		multiply: async (a, b) => a * b
	}
}
```

```svelte title="+page.svelte"
<script lang="ts">
	import { wrap } from "kkrpc"
	import { iframeParentTransportReady } from "kkrpc/iframe"
	import type { FrameAPI } from "./api"

	let iframeRef: HTMLIFrameElement
	let api: FrameAPI

	async function onIframeLoad() {
		if (!iframeRef.contentWindow) return
		const transport = await iframeParentTransportReady(iframeRef.contentWindow)
		api = wrap<FrameAPI>(transport)
	}
</script>

<iframe bind:this={iframeRef} onload={onIframeLoad} src="/iframe"></iframe>
```

```svelte title="iframe/+page.svelte"
<script lang="ts">
	import { expose } from "kkrpc"
	import { iframeChildTransportReady } from "kkrpc/iframe"
	import { frameApi } from "./api"

	const transport = await iframeChildTransportReady()
	expose(frameApi, transport)
</script>
```
