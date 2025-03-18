import { NodeIo, RPCChannel } from "kkrpc"
import pkg from "../../../../packages/kkrpc/package.json" with { type: "json" }
import { apiMethods } from "./api"

if (process.argv.includes("--version")) {
	console.log(pkg.version)
	process.exit(0)
}

console.error("Node process starts")
const stdio = new NodeIo(process.stdin, process.stdout)
const child = new RPCChannel(stdio, { expose: apiMethods })
console.error("Server is running")
