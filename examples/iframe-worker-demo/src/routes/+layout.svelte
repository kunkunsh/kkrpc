<script lang="ts">
	import { toast, Toaster } from "svelte-sonner"
	import Header from "./Header.svelte"
	import "../app.css"

	let { children } = $props()
</script>

<Toaster richColors expand />
<div class="app">
	<Header />

	<main>
		{@render children()}
	</main>

	<footer>
		<p>
			visit <a href="https://github.com/kunkunsh/kkrpc" target="_blank">github.com/kunkunsh/kkrpc</a
			> to learn about kkrpc
		</p>
	</footer>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 1rem;
		width: 100%;
		max-width: 64rem;
		margin: 0 auto;
		box-sizing: border-box;
	}

	footer {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 12px;
	}

	footer a {
		font-weight: bold;
	}

	@media (min-width: 480px) {
		footer {
			padding: 12px 0;
		}
	}
</style>
