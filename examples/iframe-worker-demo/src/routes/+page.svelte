<script lang="ts">
	import { apiImplementation, type API, type APINested } from "@kksh/demo-api"
	import { IframeParentIO, RPCChannel, type DestroyableIoInterface } from "kkrpc/browser"
	import { onDestroy, onMount } from "svelte"
	import { toast } from "svelte-sonner"

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
		rpc = new RPCChannel<API, APINested, DestroyableIoInterface>(io, apiImplementation)
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
