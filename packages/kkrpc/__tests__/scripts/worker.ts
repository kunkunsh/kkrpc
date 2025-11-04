import { WorkerChildIO } from "../../src/adapters/worker.ts"
import { RPCChannel } from "../../src/channel.ts"
import type { IoInterface } from "../../src/interface.ts"
import { apiMethods, type API } from "./api.ts"

const io: IoInterface = new WorkerChildIO()
const rpc = new RPCChannel<API, API, IoInterface>(io, { expose: apiMethods })
const api = rpc.getAPI()

// const randInt1 = Math.floor(Math.random() * 100)
// const randInt2 = Math.floor(Math.random() * 100)
// api.add(randInt1, randInt2)
