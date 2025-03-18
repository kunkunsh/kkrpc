import process from "node:process"
import { $ } from "bun"

const ext = process.platform === "win32" ? ".exe" : ""

// build node from typescript to javascript
await $`rm -rf dist-backend`
await Bun.build({
	entrypoints: ["./src/backend/node.ts"],
	outdir: "./dist-backend",
	target: "node",
	splitting: true,
	minify: true
})
await $`bun pkg dist-backend/node.js --output dist-backend/node${ext}`
await $`bun build --compile src/backend/bun.ts --outfile dist-backend/bun${ext}`

// print size of generated binaries
if (process.platform !== "win32") {
	await $`du -h ./dist-backend/*`
} else {
	await $`dir /s /a dist-backend`
}
// build svelte frontend
// await $`vite build`
