import { apiMethods, type API } from "../__tests__/scripts/api.ts"
import { WorkerChildIO } from "../src/adapters/worker.ts"
import { RPCChannel } from "../src/channel.ts"
import type { DestroyableIoInterface } from "../src/interface.ts"

const io: DestroyableIoInterface = new WorkerChildIO()
const rpc = new RPCChannel<API, API, DestroyableIoInterface>(io, apiMethods)
const api = rpc.getAPI()

const randInt1 = Math.floor(Math.random() * 100)
const randInt2 = Math.floor(Math.random() * 100)
api.add(randInt1, randInt2)
