import { defineConfig } from "vitepress"

// https://vitepress.dev/reference/site-config
export default defineConfig({
	title: "kkRPC",
	description: "kkrpc Documentation",
	themeConfig: {
		// https://vitepress.dev/reference/default-theme-config
		nav: [
			{ text: "Home", link: "/" },
			{ text: "Examples", link: "/markdown-examples" }
		],

		sidebar: [
			{
				text: "Guides",
				items: [{ text: "Getting Started", link: "/guide/getting-started" }]
			},
			{
				text: "Examples",
				items: [
					{ text: "HTTP", link: "/examples/http" },
					{ text: "stdio", link: "/examples/stdio" },
					{ text: "WebSocket", link: "/examples/ws" },
					{ text: "WebWorker", link: "/examples/webworker" },
					{ text: "Iframe", link: "/examples/iframe" }
				]
			}
		],

		socialLinks: [{ icon: "github", link: "https://github.com/kunkunsh/kkrpc" }]
	},
	markdown: {
		lineNumbers: true
	}
	// base: "./"
})
