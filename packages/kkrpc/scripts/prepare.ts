import { $ } from "bun"

// check if deno is installed
const deno = await $`deno`.text()
if (!deno) {
	process.exit(0)
}

const denoTypes = await $`deno types`.text()
// filter out the line with no-default-lib
const denoTypesFiltered = denoTypes.split("\n").filter((line) => !line.includes("no-default-lib"))
await Bun.write("./deno.d.ts", denoTypesFiltered.join("\n"))
