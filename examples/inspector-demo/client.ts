import { spawn } from "child_process"
import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { RPCChannel } from "kkrpc"
import { stdioJsonTransport } from "kkrpc/stdio"

const childProcess = spawn("bun", ["run", "server.ts"], {
	stdio: ["pipe", "pipe", "inherit"]
})

const transport = stdioJsonTransport({
	readable: childProcess.stdout!,
	writable: childProcess.stdin!
})

const rpc = new RPCChannel<APINested, APINested>(transport)
const api = rpc.getAPI()

console.log("\n=== Making RPC calls ===\n")

const echoResult = await api.echo("Hello Inspector!")
console.log("Echo result:", echoResult)

const sum = await api.math.grade1.add(5, 3)
console.log("5 + 3 =", sum)

const product = await api.math.grade2.multiply(4, 6)
console.log("4 * 6 =", product)

console.log("\n=== Inspector Output ===")
console.log("Native inspector events are emitted by the server on stderr while it handles requests.")

rpc.destroy()
childProcess.kill()
process.exit(0)
