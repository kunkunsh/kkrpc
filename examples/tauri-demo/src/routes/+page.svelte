<script lang="ts">
	import CodeBlock from "$lib/components/code-block.svelte"
</script>

<main class="container flex flex-col gap-4 py-4">
	<h1 class="text-2xl font-bold">Tauri <code>kkrpc</code> Demo</h1>
	<p>
		This demo tauri app is to show how to use <code>kkrpc</code> to call functions defined in
		<code>bun</code>, <code>deno</code> or <code>node</code> processes.
	</p>
	<p>
		<code>kkrpc</code> can work like Electron's <code>contentBridge</code>. After wiring up the
		<code>kkrpc</code> channel, you can call any function defined in the sidecar process.
	</p>
	<p>
		There are 2 ways to use <code>kkrpc</code>. You can either embed compiled <code>bun</code>,
		<code>deno</code>
		or
		<code>node</code> program as sidecars of Tauri app. They introduce ~60+MB to the bundle size. (Before
		compression). After compression, a plain Tauri app installer is ~25MB.
	</p>
	<p>
		The second way assumes user has <code>bun</code>, <code>deno</code> or <code>node</code> installed
		on their computer, so we don't need to bundle a sidecar in the app.
	</p>
	<p>Let's Compare with Electron</p>

	<h2 class="text-xl font-bold">Electron</h2>
	<CodeBlock
		code={`// Preload (Isolated World)
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld(
  'electron',
  {
    doThing: () => ipcRenderer.send('do-a-thing')
  }
)

// Renderer (Main World)
window.electron.doThing()`}
	/>
	<h2 class="text-xl font-bold">Tauri + kkrpc</h2>
	<CodeBlock
		class="w-full overflow-x-auto"
		code={`// Deno Process
import { DenoIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api.js"

const stdio = new DenoIo(Deno.stdin.readable)
// expose an object containing functions to the other side
// nested objects are supported
const child = new RPCChannel(stdio, { expose: apiMethods })`}
	/>

	<CodeBlock
		code={`// WebView Process
// Spawn the sidecar process
const cmd = Command.sidecar("binaries/deno-sidecar")
const process = await cmd.spawn()

// Establish the bidirectional kkrpc channel
const stdio = new TauriShellStdio(cmd.stdout, process)
const stdioRPC = new RPCChannel<{}, API>(stdio, {})
const api = stdioRPC.getAPI()

// Call the API
console.log(await api.fibonacci(fibNumber))`}
	></CodeBlock>
</main>

<style scoped>
	code {
		@apply text-yellow-300;
	}
</style>
