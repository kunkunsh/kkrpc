import { BunIo, RPCChannel } from "../../mod.ts"
import { apiMethods } from "./api.ts"

const stdio = new BunIo(Bun.stdin.stream())
const child = new RPCChannel(stdio, { expose: apiMethods })
