<script lang="ts">
	import { apiImplementation, type API, type APINested } from "@kksh/demo-api"
	import Worker from "$lib/worker?worker"
	import { RPCChannel, WorkerParentIO, type DestroyableIoInterface } from "kkrpc/browser"
	import { toast } from "svelte-sonner"

	const worker = new Worker()
	const io = new WorkerParentIO(worker)
	const rpc = new RPCChannel<API, APINested, DestroyableIoInterface>(io, {
		expose: apiImplementation
	})
	const api = rpc.getAPI()

	function onAddClicked() {
		const randInt1 = Math.floor(Math.random() * 100)
		const randInt2 = Math.floor(Math.random() * 100)
		api.math.grade1
			.add(randInt1, randInt2, (sum) => {
				toast.info("Worker Calculated Sum (callback)", {
					description: `${randInt1} + ${randInt2} = ${sum}`
				})
			})
			.then((sum) => {
				toast.info("Worker Calculated Sum", {
					description: `${randInt1} + ${randInt2} = ${sum}`
				})
			})
	}

	function onMultiplyClicked() {
		const randInt1 = Math.floor(Math.random() * 100)
		const randInt2 = Math.floor(Math.random() * 100)
		api.math.grade2
			.multiply(randInt1, randInt2, (product) => {
				toast.info("Worker Calculated Product (callback)", {
					description: `${randInt1} * ${randInt2} = ${product}`
				})
			})
			.then((product) => {
				toast.info("Worker Calculated Product", {
					description: `${randInt1} * ${randInt2} = ${product}`
				})
			})
	}
</script>

<h1 class="text-2xl font-bold">Worker</h1>
<p>This example calls API methods exposed from Web Worker to do math.</p>

<ul class="menu bg-base-200 rounded-box w-56">
	<li><button class="btn" onclick={onAddClicked}>Add</button></li>
	<li><button class="btn" onclick={onMultiplyClicked}>math.grade2.multiply</button></li>
</ul>
