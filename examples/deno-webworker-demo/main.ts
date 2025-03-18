import { apiImplementation, type API, type APINested } from "@kunkun/demo-api"
import { RPCChannel, WorkerParentIO, type DestroyableIoInterface } from "kkrpc"

const worker = new Worker(new URL("./worker.ts", import.meta.url).href, { type: "module" })
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel<API, APINested, DestroyableIoInterface>(io, {
	expose: apiImplementation
})
const api = rpc.getAPI()
api.math.grade2
	.multiply(2, 3)
	.then((product) => {
		console.log("from deno main thread: api.math.grade2.multiply(2, 3) = ", product)
	})
	.finally(() => {
		io.destroy()
	})
