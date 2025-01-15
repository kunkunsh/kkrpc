import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["./mod.ts", "./browser-mod.ts", "./http.ts", "./chrome.ts"],
	dts: true,
	format: ["cjs", "esm"],
	clean: true
})
