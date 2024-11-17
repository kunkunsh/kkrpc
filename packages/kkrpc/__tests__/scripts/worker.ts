import { RPCChannel, WorkerChildIO, type DestroyableIoInterface } from "../../mod.ts"
import { apiMethods, type API } from "./api.ts"

const io: DestroyableIoInterface = new WorkerChildIO()
const rpc = new RPCChannel<API, API, DestroyableIoInterface>(io, apiMethods)
const api = rpc.getAPI()

const randInt1 = Math.floor(Math.random() * 100)
const randInt2 = Math.floor(Math.random() * 100)
api.add(randInt1, randInt2)
