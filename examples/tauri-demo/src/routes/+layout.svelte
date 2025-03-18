<script lang="ts">
	import "../app.css"
	import { Sidebar } from "@kksh/svelte5"
	import AppSidebar from "$lib/components/app-sidebar.svelte"
	import { ModeWatcher } from "mode-watcher"
	import { toast, Toaster } from "svelte-sonner"

	let { children } = $props()
</script>

<ModeWatcher />
<Toaster richColors />
<Sidebar.Provider>
	<AppSidebar />
	<main class="w-full">
		<Sidebar.Trigger class="fixed" />
		{@render children?.()}
	</main>
</Sidebar.Provider>
