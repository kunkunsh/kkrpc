import { apiImplementationNested, type API, type APINested } from "@kksh/demo-api"
import { RPCChannel, WorkerChildIO, type DestroyableIoInterface } from "kkrpc/browser"

const io: DestroyableIoInterface = new WorkerChildIO()
const rpc = new RPCChannel<APINested, API, DestroyableIoInterface>(io, {
	expose: apiImplementationNested
})
const api = rpc.getAPI()

const randInt1 = Math.floor(Math.random() * 100)
const randInt2 = Math.floor(Math.random() * 100)
api.add(randInt1, randInt2).then((sum) => {
	console.log(`from worker, calculated in main thread: api.add(${randInt1}, ${randInt2})`, sum)
})
