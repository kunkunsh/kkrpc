import { apiImplementation, type API, type APINested } from "@kunkun/demo-api"
import { RPCChannel } from "kkrpc"
import { workerTransport } from "kkrpc/worker"

const worker = new Worker(new URL("./worker.ts", import.meta.url).href, { type: "module" })
const rpc = new RPCChannel<API, APINested>(workerTransport(worker), {
	expose: apiImplementation
})
const api = rpc.getAPI()
api.math.grade2
	.multiply(2, 3)
	.then((product) => {
		console.log("from deno main thread: api.math.grade2.multiply(2, 3) = ", product)
	})
	.finally(() => {
		rpc.destroy()
	})
