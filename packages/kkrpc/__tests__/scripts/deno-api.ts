import { DenoIo, RPCChannel } from "../../mod.ts"
import { apiMethods } from "./api.ts"

const io = new DenoIo(Deno.stdin.readable)
const child = new RPCChannel(io, { expose: apiMethods })
