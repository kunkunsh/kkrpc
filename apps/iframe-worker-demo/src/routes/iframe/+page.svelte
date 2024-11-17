<script lang="ts">
	import {
		apiImplementation,
		apiImplementationNested,
		type API,
		type APINested
	} from "@kksh/demo-api"
	import { IframeChildIO, RPCChannel, type DestroyableIoInterface } from "kkrpc"
	import { onDestroy, onMount } from "svelte"
	import { toast } from "svelte-sonner"

	const io = new IframeChildIO(),
		rpc = new RPCChannel<APINested, API, DestroyableIoInterface>(io, apiImplementationNested)

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
