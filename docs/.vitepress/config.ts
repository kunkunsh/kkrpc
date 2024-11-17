import { defineConfig } from "vitepress"

// https://vitepress.dev/reference/site-config
export default defineConfig({
	title: "kkrpc",
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
				items: [{ text: "HTTP", link: "/examples/http-demo" }]
			}
		],

		socialLinks: [{ icon: "github", link: "https://github.com/kunkunsh/kkrpc" }]
	},
	markdown: {
		lineNumbers: true
	}
})
