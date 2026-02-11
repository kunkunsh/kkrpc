import { apiImplementationNested, type API, type APINested } from "@kksh/demo-api"
import { RPCChannel, WorkerChildIO, type IoInterface } from "kkrpc/browser"

const io: IoInterface = new WorkerChildIO()
const rpc = new RPCChannel<APINested, API, IoInterface>(io, {
	expose: apiImplementationNested
})
const api = rpc.getAPI()

const randInt1 = Math.floor(Math.random() * 100)
const randInt2 = Math.floor(Math.random() * 100)
api.add(randInt1, randInt2).then((sum) => {
	console.log(`from worker, calculated in main thread: api.add(${randInt1}, ${randInt2})`, sum)
})
