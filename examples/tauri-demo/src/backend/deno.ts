import { parseArgs } from "jsr:@std/cli/parse-args"

const flags = parseArgs(Deno.args, {
	boolean: ["version"]
})

if (flags.version) {
	console.log("1.0.0")
	Deno.exit(0)
}
