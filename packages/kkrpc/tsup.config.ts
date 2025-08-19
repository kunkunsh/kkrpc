import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["./mod.ts", "./browser-mod.ts", "./http.ts", "./deno-mod.ts", "./chrome-extension.ts"],
	dts: true,
	format: ["cjs", "esm"],
	clean: true
})
