import { DenoIo, RPCChannel } from "@kunkun/kkrpc/deno"
import { parseArgs } from "jsr:@std/cli/parse-args"
import pkg from "../../packages/kkrpc/package.json" with { type: "json" }

const flags = parseArgs(Deno.args, {
	boolean: ["version"]
})

if (flags.version) {
	console.log(pkg.version)
	Deno.exit(0)
}

const stdio = new DenoIo(Deno.stdin.readable)
const child = new RPCChannel(stdio, { expose: {} })

console.error("Deno is running")
