import { parseArgs } from "jsr:@std/cli/parse-args"
import { DenoIo, RPCChannel } from "kkrpc/deno"
import pkg from "../../packages/kkrpc/package.json" with { type: "json" }

const flags = parseArgs(Deno.args, {
	boolean: ["version"]
})

if (flags.version) {
	console.log(pkg.version)
	Deno.exit(0)
}

const stdio = new DenoIo(Deno.stdin.readable)
const channel = new RPCChannel(stdio, {
	expose: {
		eval: (code: string) => {
			return eval(code)
		}
	}
})

const api = channel.getAPI()
api.eval("console.log('Hello, world!')")

console.error("Deno is running")
