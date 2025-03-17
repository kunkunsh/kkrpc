<script lang="ts">
	import { Button } from "@kksh/svelte5"
	import { Child, Command } from "@tauri-apps/plugin-shell"
</script>

<Button
	onclick={async () => {
		const command = Command.create("run-bun", [
			"run",
			"/Users/hk/Dev/kkrpc/examples/tauri-demo/sample-script/bun.ts"
		])
		const child = await command.spawn()

		command.stdout.on("data", (data) => {
			console.log("stdout", data)
		})
		command.stderr.on("data", (data) => {
			console.warn("stderr", data)
		})
		command.on("close", (code) => {
			console.log("close", code)
		})
		command.on("error", (err) => {
			console.error("error", err)
		})

		await new Promise((resolve) => setTimeout(resolve, 1_000))
		child.write("Hello from Tauri\n")
		await new Promise((resolve) => setTimeout(resolve, 1_000))
		child.write("Hello from Tauri 2\n")
		await new Promise((resolve) => setTimeout(resolve, 1_000))
		child.write("Hello from Tauri 3\n")
	}}
>
	Debug Bun
</Button>
