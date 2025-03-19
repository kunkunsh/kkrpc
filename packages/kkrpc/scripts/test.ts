import { $ } from "bun"

await $`deno test -R __deno_tests__`
const buildOutput = await Bun.build({
	entrypoints: ["__tests__/scripts/node-api.js"],
	outdir: "__tests__/scripts",
	target: "node",
	format: "esm"
})

await $`bun test __tests__ --coverage`.env({
	...process.env,
	FORCE_COLOR: "1"
})
