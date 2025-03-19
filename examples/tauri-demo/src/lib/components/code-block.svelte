<script lang="ts">
	import { createHighlighter } from "shiki"
	import { ShikiMagicMove } from "shiki-magic-move/svelte"
	import "shiki-magic-move/dist/style.css"
	import { cn } from "$lib/utils"

	let { code = $bindable(""), class: className }: { code: string; class?: string } = $props()

	const highlighter = createHighlighter({
		themes: ["nord"],
		langs: ["typescript"]
	})
</script>

{#await highlighter then highlighter}
	<ShikiMagicMove
		lang="ts"
		class={cn("overflow-auto p-3", className)}
		theme="nord"
		{highlighter}
		{code}
		options={{ duration: 800, stagger: 0.3, lineNumbers: true }}
	/>
{/await}
