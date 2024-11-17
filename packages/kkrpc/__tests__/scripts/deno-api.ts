import { DenoIo, RPCChannel } from "../../mod.ts"
import { apiMethods } from "./api.ts"

const io = new DenoIo(Deno.stdin.readable, Deno.stdout.writable)
const child = new RPCChannel(io, apiMethods)
