import {
	apiImplementation,
	apiImplementationNested,
	type API,
	type APINested
} from "@kksh/demo-api"
import { NodeIo, RPCChannel } from "kkrpc"

const stdio = new NodeIo(process.stdin, process.stdout)

const rpc = new RPCChannel<APINested, APINested>(stdio, {
	expose: apiImplementationNested
})

console.error("Server running...")
