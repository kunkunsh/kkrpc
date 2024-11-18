import { readFileSync } from "fs"
import path, { join } from "path"
import { cwd } from "process"
import typescript from "@rollup/plugin-typescript"

const pkg = JSON.parse(readFileSync(join(cwd(), "package.json"), "utf8"))

/** @type {import('rollup').RollupOptions} */
const config = {
	input: ["./mod.ts", "./browser-mod.ts", "./http.ts"],
	output: [
		{
			dir: "dist",
			format: "cjs",
			entryFileNames: "[name].cjs",
			chunkFileNames: "[name]-[hash].js",
			preserveModules: true,
			preserveModulesRoot: "src"
		},
		{
			dir: "dist",
			format: "esm",
			entryFileNames: "[name].js",
			chunkFileNames: "[name]-[hash].js",
			preserveModules: true,
			preserveModulesRoot: "src"
		}
	],
	treeshake: true,
	plugins: [typescript()]
}

export default config
