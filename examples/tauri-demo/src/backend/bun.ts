import { BunIo, RPCChannel } from "kkrpc"
import { api } from "./api"

console.error("Bun process starts")
const stdio = new BunIo(Bun.stdin.stream())
const child = new RPCChannel(stdio, { expose: api })
console.error("Server is running")
