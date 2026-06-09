import { RPCChannel } from "kkrpc"
import { stdioJsonTransport } from "kkrpc/stdio"
import { api } from "./api"
import { promiseWritable, ReadableStreamLike } from "./stream-stdio"

console.error("Bun process starts")
const stdio = stdioJsonTransport({
	readable: new ReadableStreamLike(Bun.stdin.stream()),
	writable: promiseWritable((chunk) => Bun.write(Bun.stdout, chunk))
})
const child = new RPCChannel(stdio, { expose: api })
console.error("Server is running")
