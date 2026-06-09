import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { RPCChannel } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"

const stdio = nodeStdioTransport()

const rpc = new RPCChannel<APINested, APINested>(stdio, {
	expose: apiImplementationNested
})

console.error("Server running...")
