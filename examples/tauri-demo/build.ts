import path from "node:path"
import process from "node:process"
import { $ } from "bun"

const ext = process.platform === "win32" ? ".exe" : ""

// compile deno backend
const cwd = process.cwd()
const binariesDir = path.join(cwd, "src-tauri/binaries")
console.log("binariesDir", binariesDir)
const denoBackendDir = path.join(cwd, "../deno-backend")
await $`deno compile -A -o deno${ext} main.ts`.cwd(denoBackendDir)
await $`cp deno${ext} ${binariesDir}/deno${ext}`.cwd(denoBackendDir)

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
await $`cp dist-backend/node${ext} ${binariesDir}/node${ext}`
await $`bun build --compile src/backend/bun.ts --outfile dist-backend/bun${ext}`
await $`cp dist-backend/bun${ext} ${binariesDir}/bun${ext}`

// print size of generated binaries
if (process.platform !== "win32") {
	await $`du -h ${binariesDir}/*`
} else {
	await $`dir /s /a ${binariesDir}/*`
}
// build svelte frontend
await $`vite build`
