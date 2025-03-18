import { parseArgs } from "util"
import { BunIo, RPCChannel } from "kkrpc"
import pkg from "../../../../packages/kkrpc/package.json" with { type: "json" }
import { api } from "./api"

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

console.error("Bun process starts")
const stdio = new BunIo(Bun.stdin.stream())
const child = new RPCChannel(stdio, { expose: api })
console.error("Server is running")
