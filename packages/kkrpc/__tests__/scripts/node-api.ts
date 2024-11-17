import { NodeIo, RPCChannel } from "../../mod.ts"
import { apiMethods } from "./api.ts"

const stdio = new NodeIo(process.stdin, process.stdout)
const child = new RPCChannel(stdio, apiMethods)
