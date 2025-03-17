<script lang="ts">
	import "../app.css"
	import { ModeWatcher } from "mode-watcher"
	import { toast, Toaster } from "svelte-sonner"

	let { children } = $props()
</script>

<ModeWatcher />
<Toaster richColors />
{@render children()}
