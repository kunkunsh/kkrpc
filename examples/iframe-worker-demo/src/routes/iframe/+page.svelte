<script lang="ts">
	import { apiImplementationNested } from "@kksh/demo-api"
	import type { API, APINested } from "@kksh/demo-api"
	import { RPCChannel } from "kkrpc/browser"
	import { iframeChildTransport } from "kkrpc/iframe"
	import { onDestroy, onMount } from "svelte"
	import { toast } from "svelte-sonner"

	const rpc = new RPCChannel<APINested, API>(iframeChildTransport(), {
		expose: apiImplementationNested
	})

	onMount(() => {})
	onDestroy(() => {
		rpc.destroy()
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
