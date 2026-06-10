import { apiImplementationNested, type API, type APINested } from "@kunkun/demo-api"
import { RPCChannel } from "kkrpc"
import { workerSelfTransport } from "kkrpc/worker"

console.log("worker loaded")

const rpc = new RPCChannel<APINested, API>(workerSelfTransport(), {
	expose: apiImplementationNested
})
const api = rpc.getAPI()

const randInt1 = Math.floor(Math.random() * 100)
const randInt2 = Math.floor(Math.random() * 100)
api.add(randInt1, randInt2).then((sum) => {
	console.log(`from worker, calculated in main thread: api.add(${randInt1}, ${randInt2})`, sum)
})
