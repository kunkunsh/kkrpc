<script lang="ts">
	import { Alert, Button, Select } from "@kksh/svelte5"
	import { InfoIcon } from "@lucide/svelte"
	import { openUrl } from "@tauri-apps/plugin-opener"
	import * as os from "@tauri-apps/plugin-os"
	import { Command } from "@tauri-apps/plugin-shell"
	import CodeBlock from "$lib/components/code-block.svelte"
	import CodeEditor from "$lib/components/code-editor.svelte"
	import SelectRuntime from "$lib/components/select-runtime.svelte"
	import { RPCChannel, TauriShellStdio } from "kkrpc/browser"
	import { PersistedState } from "runed"
	import { onMount } from "svelte"
	import { toast } from "svelte-sonner"
	import { type api as apiMethods } from "../../../backend/api"
	import { sampleScripts } from "./sample-scripts"

	const platform = os.platform()
	let code = $state("")
	let currentRuntime: "node" | "deno" | "bun" = $state("node")
	let stdout = $state("")
	let stderr = $state("")

	function refresh() {
		console.log("refreshing")
		stdout = ""
		stderr = ""
		console.log("setting code", currentRuntime)
		code = sampleScripts[currentRuntime]
		// console.log(sampleScripts[currentRuntime])
	}

	$effect(() => {
		console.log("currentRuntime changed", currentRuntime)
		refresh()
	})

	onMount(() => {
		refresh()
	})

	async function runCode() {
		const cmd = Command.sidecar(`binaries/${currentRuntime}`)
		cmd.stdout.on("data", (data) => {
			stdout += data
		})
		cmd.stderr.on("data", (data) => {
			stderr += data
		})

		cmd.on("close", () => {
			toast.info(`Code executed successfully`)
		})

		cmd.on("error", (err) => {
			console.error("command error", err)
			toast.error(`Failed to run code`, {
				description: err
			})
		})
		cmd
			.spawn()
			.then((proc) => {
				const stdio = new TauriShellStdio(cmd.stdout, proc)
				const stdioRPC = new RPCChannel<{}, typeof apiMethods>(stdio, {})
				const api = stdioRPC.getAPI()
				return api.eval(code).finally(() => {
					return proc
						.kill()
						.then(() => {
							console.log("proc killed")
							toast.info(`Process terminated`)
						})
						.catch((err) => {
							console.error("failed to kill proc", err)
							toast.error(`Failed to kill proc`, {
								description: err
							})
						})
				})
			})
			.catch((error) => {
				console.error("error", error)
				toast.error(`Failed to run code`, {
					description: error instanceof Error ? error.message : String(error)
				})
			})
	}
</script>

<main class="container mx-auto flex flex-col gap-1 p-4">
	<h1 class="text-2xl font-bold">Sidecar with <code>kkrpc</code></h1>
	<Alert.Root class="bg-blue-500/50">
		<InfoIcon class="size-4" />
		<Alert.Title>Explanation</Alert.Title>
		<Alert.Description>
			<p>This Example demonstrate executing any JS/TS code with sidecars in different runtimes.</p>
			<code>eval()</code> is run in the backend, and the <code>stdio</code> is displayed. Each
			runtime has sample code with their distinct features. You can modify the code and run it
			again.
			<p>
				The backend runtime are compiled binary, not the CLI. You can theoretically write any code
				in backend, just like in Electron. For example, CRUD on sqlite database.
			</p>
		</Alert.Description>
	</Alert.Root>
	<div class="flex justify-end">
		<SelectRuntime bind:value={currentRuntime} />
	</div>
	{#if currentRuntime === "bun" && platform === "macos"}
		<Alert.Root class="bg-red-500/50">
			<Alert.Title>Heads up!</Alert.Title>
			<Alert.Description>
				Bun has bug on MacOS. <code>stdin</code> is not working, preventing kkrpc from working. Please
				use Node.js or Deno instead.
			</Alert.Description>
			<button
				class="hover:text-blue-400 hover:underline"
				onclick={() => openUrl("https://github.com/kunkunsh/kkrpc/issues/11")}
			>
				https://github.com/kunkunsh/kkrpc/issues/11
			</button>
		</Alert.Root>
	{/if}
	{#key currentRuntime}
		<CodeEditor class="min-h-96" bind:code />
	{/key}

	<Button class="w-full" onclick={runCode}>Run</Button>
	<div class="grid grid-cols-2 gap-4">
		<div>
			<p>stdout</p>
			<CodeBlock code={stdout} />
		</div>
		<div>
			<p>stderr</p>
			<CodeBlock code={stderr} />
		</div>
	</div>
	<!-- <pre>stdout: {stdout}</pre>
	<pre>stderr: {stderr}</pre> -->
</main>
