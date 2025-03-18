<script lang="ts">
	import { Button } from "@kksh/svelte5"
	import CodeEditor from "$lib/components/code-editor.svelte"

	let code = $state("")

	function runCode() {
		console.log(code)
	}
</script>

<div class="relative border-2 border-red-500">
	<Button class="absolute right-2 top-2 z-10" onclick={runCode}>Run</Button>
	<CodeEditor class="min-h-96" bind:code />
</div>
