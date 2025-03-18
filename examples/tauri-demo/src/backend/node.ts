import { parseArgs } from "node:util"

const { values: flags } = parseArgs({
	args: process.argv,
	options: {
		version: {
			type: "boolean"
		}
	},
	strict: true,
	allowPositionals: true
})

if (flags.version) {
	console.log("1.0.0")
}
