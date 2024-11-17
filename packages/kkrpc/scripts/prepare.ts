import { $ } from "bun"

// check if CF_PAGES is set to 1
const isCFPages = process.env.CF_PAGES === "1"
if (isCFPages) {
	process.exit(0)
}

const denoTypes = await $`deno types`.text()
// filter out the line with no-default-lib
const denoTypesFiltered = denoTypes.split("\n").filter((line) => !line.includes("no-default-lib"))
await Bun.write("./deno.d.ts", denoTypesFiltered.join("\n"))
