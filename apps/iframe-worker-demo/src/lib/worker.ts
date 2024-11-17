import { RPCChannel, WorkerChildIO } from "kkrpc"
import type { DestroyableIoInterface } from "kkrpc"
import { apiImplementation, apiImplementation2, type API, type API2 } from "./api"

console.log("worker loaded")

const io: DestroyableIoInterface = new WorkerChildIO()
const rpc = new RPCChannel<API2, API, DestroyableIoInterface>(io, apiImplementation2)
const api = rpc.getAPI()

const randInt1 = Math.floor(Math.random() * 100)
const randInt2 = Math.floor(Math.random() * 100)
api.add(randInt1, randInt2).then((sum) => {
	console.log(`from worker, calculated in main thread: api.add(${randInt1}, ${randInt2})`, sum)
})
