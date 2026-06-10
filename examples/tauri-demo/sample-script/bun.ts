import { RPCChannel } from "kkrpc"
import { stdioJsonTransport } from "kkrpc/stdio"
import { apiMethods } from "./api.js"
import { promiseWritable, ReadableStreamLike } from "../src/backend/stream-stdio"

console.error("Starting Bun script")
const stdio = stdioJsonTransport({
	readable: new ReadableStreamLike(Bun.stdin.stream()),
	writable: promiseWritable((chunk) => Bun.write(Bun.stdout, chunk))
})
const rpc = new RPCChannel(stdio, { expose: apiMethods })
const api = rpc.getAPI()
