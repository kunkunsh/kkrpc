import { defineConfig } from "tsdown"

export default defineConfig({
	entry: [
		"./mod.ts",
		"./browser-mod.ts",
		"./http.ts",
		"./deno-mod.ts",
		"./chrome-extension.ts",
		"./socketio.ts"
	],
	dts: true,
	format: ["cjs", "esm"],
	clean: true,
	minify: true
})
