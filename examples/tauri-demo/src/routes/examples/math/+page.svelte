<script lang="ts">
	import { Alert, Button, Input } from "@kksh/svelte5"
	import { InfoIcon } from "@lucide/svelte"
	import { open } from "@tauri-apps/plugin-dialog"
	import { openUrl } from "@tauri-apps/plugin-opener"
	import { Child, Command } from "@tauri-apps/plugin-shell"
	import CodeBlock from "$lib/components/code-block.svelte"
	import { RPCChannel, TauriShellStdio } from "kkrpc/browser"
	import { toast } from "svelte-sonner"
	import { type apiMethods as remoteAPI } from "../../../../sample-script/api.js"

	function fibonacci(n: number): number {
		if (n <= 0) return 0
		if (n === 1) return 1
		return fibonacci(n - 1) + fibonacci(n - 2)
	}

	const localAPIImplementation = {
		add: (a: number, b: number) => Promise.resolve(a + b),
		fibonacci
	}
	type RemoteAPI = typeof remoteAPI
	let process = $state<Child | null>(null)
	let stdioRPC = $state<RPCChannel<typeof localAPIImplementation, RemoteAPI> | null>(null)

	async function spawnCmd(runtime: "deno" | "bun" | "node") {
		let cmd: Command<string>
		if (runtime === "deno") {
			cmd = Command.create("deno", ["run", "-A", scriptPath])
			process = await cmd.spawn()
		} else if (runtime === "bun") {
			cmd = Command.create("bun", [scriptPath])
			process = await cmd.spawn()
		} else if (runtime === "node") {
			cmd = Command.create("node", [scriptPath])
			process = await cmd.spawn()
		} else {
			return toast.error(`Invalid runtime: ${runtime}, pick deno, bun or node`)
		}

		cmd.stdout.on("data", (data) => {
			console.log("stdout", data)
		})
		cmd.stderr.on("data", (data) => {
			console.warn("stderr", data)
		})
		cmd.on("close", (code) => {
			console.log("close", code)
		})
		cmd.on("error", (err) => {
			console.error("error", err)
		})

		const stdio = new TauriShellStdio(cmd.stdout, process)
		stdioRPC = new RPCChannel<typeof localAPIImplementation, RemoteAPI>(stdio, {
			expose: localAPIImplementation
		})
	}
	function run(runtime: "deno" | "bun" | "node") {
		return spawnCmd(runtime)
			.then(() => {
				toast.success("Script running, you can now use the API")
			})
			.catch((err) => {
				console.error(err)
				toast.error("Failed to run script", {
					description: err.message
				})
			})
	}

	async function pickScript() {
		const result = await open({
			directory: false
		})
		if (result) {
			scriptPath = result
		}
	}

	let scriptPath = $state("")
	let fibNumber = $state(10)
	let fibResult = $state(0)
</script>

<div class="container mx-auto flex flex-col gap-2">
	<h1 class="text-2xl font-bold">
		Direct <code>bun/node/deno</code> CLI call with <code>kkrpc</code>
	</h1>
	<Alert.Root class="bg-blue-500/50">
		<InfoIcon class="size-4" />
		<Alert.Title>Explanation</Alert.Title>
		<Alert.Description>
			<p>
				This example demonstrates calling <code>bun/node/deno</code> CLI directly with
				<code>kkrpc</code>.
			</p>
			<p>
				The runtime executables should be in system <code>PATH</code>, otherwise it won't run.
			</p>
			<p>
				Press Pick Script, then select <code>bun.ts</code>, <code>deno.ts</code> or
				<code>node.js</code> script from <code>sample-script</code> folder of this example tauri app.
			</p>
			<span class="text-red-400">
				There is a known bug with bun's stdin on MacOS, kkrpc will not work on Mac for now.
			</span>
			<button
				class="text-green-500 hover:text-blue-400 hover:underline"
				onclick={() => openUrl("https://github.com/kunkunsh/kkrpc/issues/11")}
			>
				https://github.com/kunkunsh/kkrpc/issues/11
			</button>
		</Alert.Description>
	</Alert.Root>
	<div class="flex gap-2">
		<Input placeholder="Script path" disabled bind:value={scriptPath} />
		<Button onclick={pickScript}>Pick Script</Button>
	</div>
	<div class="grid grid-cols-4 gap-2">
		<Button disabled={!scriptPath} onclick={() => run("deno")}>Run with Deno</Button>
		<Button disabled={!scriptPath} onclick={() => run("bun")}>Run with Bun</Button>
		<Button disabled={!scriptPath} onclick={() => run("node")}>Run with Node</Button>
		<Button
			variant="destructive"
			disabled={!process}
			onclick={() => {
				process
					?.kill()
					.catch((err) => {
						toast.error(`Failed to kill process`, { description: err.message })
					})
					.finally(() => {
						process = null
						stdioRPC = null
					})
			}}
		>
			Kill
		</Button>
	</div>
	<h1 class="text-2xl font-bold">Run Fibonacci in Bun or Deno</h1>
	<Input
		bind:value={fibNumber}
		min={1}
		max={50}
		placeholder="Fibonacci number (don't use a number larger than 30, it will take forever)"
	/>
	<Button
		disabled={!stdioRPC}
		onclick={async () => {
			if (!stdioRPC) {
				return toast.error("Please run the script first")
			}
			const api = stdioRPC.getAPI()
			return api
				.fibonacci(fibNumber)
				.then((result) => {
					fibResult = result
					toast.success(`Fibonacci ${fibNumber} is ${result}`)
				})
				.catch((err) => {
					console.error(err)
					toast.error("Failed to calculate fibonacci", { description: err.message })
				})
		}}
	>
		Fibonacci
	</Button>
	<p>Result: {fibResult}</p>
	<h2 class="text-xl font-bold">Sample Code</h2>
	<p>
		Here is the sample code to call the <code>fibonacci</code> function from the script.
	</p>
	<p>
		You can define any function in <code>bun</code>, <code>deno</code> or <code>node</code> and call
		it from tauri app.
	</p>
	<CodeBlock
		code={`
const stdio = new TauriShellStdio(cmd.stdout, process)
stdioRPC = new RPCChannel<{}, API>(stdio, {})
const api = stdioRPC.getAPI()
console.log(await api.fibonacci(fibNumber))
	`}
	/>
</div>

<style scoped>
	code {
		@apply text-yellow-300;
	}
</style>
