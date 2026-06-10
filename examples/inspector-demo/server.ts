import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { RPCChannel } from "kkrpc"
import { createInspector, type InspectEvent, type InspectorBackend } from "kkrpc/inspector"
import { nodeStdioTransport } from "kkrpc/stdio"

const stdio = nodeStdioTransport()
const stderrBackend: InspectorBackend = {
	log(event: InspectEvent) {
		console.error(`[inspector] ${event.direction} ${JSON.stringify(event.message)}`)
	}
}
const inspector = createInspector({ backends: [stderrBackend], options: { trackLatency: true } })

const rpc = new RPCChannel<APINested, APINested>(stdio, {
	expose: apiImplementationNested,
	plugins: [inspector.plugin("server-session")]
})

console.error("Server running...")
