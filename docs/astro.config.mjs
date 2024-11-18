// @ts-check
import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: "kkRPC",
			social: {
				github: "https://github.com/kunkunsh/kkrpc"
			},
			sidebar: [
				{
					label: "Guides",
					autogenerate: { directory: "guides" }
				},
				{
					label: "Examples",
					autogenerate: { directory: "examples" }
				},
				{
					label: "Reference",
					autogenerate: { directory: "reference" }
				}
			]
		})
	]
})
