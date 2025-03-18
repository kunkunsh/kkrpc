<script lang="ts">
	import { shikiToMonaco } from "@shikijs/monaco"
	import { cn } from "$lib/utils"
	import * as monaco from "monaco-editor-core"
	import { createHighlighter } from "shiki"
	import { onMount } from "svelte"

	let { code = $bindable(""), class: className }: { code: string; class?: string } = $props()

	onMount(async () => {
		// Create the highlighter, it can be reused
		const highlighter = await createHighlighter({
			themes: ["github-dark-default"],
			langs: ["typescript"]
		})

		// Register the languageIds first. Only registered languages will be highlighted.
		monaco.languages.register({ id: "vue" })
		monaco.languages.register({ id: "typescript" })
		monaco.languages.register({ id: "javascript" })

		// Register the themes from Shiki, and provide syntax highlighting for Monaco.
		shikiToMonaco(highlighter, monaco)

		// Create the editor
		const editor = monaco.editor.create(document.getElementById("editor")!, {
			value: code,
			language: "javascript",
			theme: "github-dark-default"
		})

		// Set up two-way binding
		editor.onDidChangeModelContent(() => {
			code = editor.getValue()
		})
	})
</script>

<div id="editor" class={cn("h-full w-full", className)}></div>
