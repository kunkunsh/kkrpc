// @ts-check
import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"
import starlightLlmsTxt from "starlight-llms-txt"

// https://astro.build/config
export default defineConfig({
	site: "https://docs.kkrpc.kunkun.sh",
	integrations: [
		starlight({
			title: "kkRPC",
			social: [{ icon: "github", label: "GitHub", href: "https://github.com/kunkunsh/kkrpc" }],
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
			],
			plugins: [starlightLlmsTxt()]
		})
	]
})
