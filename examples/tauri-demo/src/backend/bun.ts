import { parseArgs } from "util"
import pkg from "../../../../packages/kkrpc/package.json" with { type: "json" }

const { values: flags } = parseArgs({
	args: Bun.argv,
	options: {
		version: {
			type: "boolean"
		}
	},
	strict: true,
	allowPositionals: true
})

if (flags.version) {
	console.log(pkg.version)
	process.exit(0)
}
