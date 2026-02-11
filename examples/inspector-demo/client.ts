import { spawn } from "child_process"
import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { NodeIo, RPCChannel } from "kkrpc"
import { consolePrettyBackend, createInspector, FileBackend, MemoryBackend } from "kkrpc/inspector"

const memoryBackend = new MemoryBackend()

const inspector = createInspector({
	backends: [consolePrettyBackend, new FileBackend({ path: "./inspector.log" }), memoryBackend],
	options: {
		trackLatency: true
	}
})

const childProcess = spawn("bun", ["run", "server.ts"], {
	stdio: ["pipe", "pipe", "inherit"]
})

const io = inspector.wrap(new NodeIo(childProcess.stdout!, childProcess.stdin!), "client-session")

const rpc = new RPCChannel<APINested, APINested>(io)
const api = rpc.getAPI()

console.log("\n=== Making RPC calls ===\n")

const echoResult = await api.echo("Hello Inspector!")
console.log("Echo result:", echoResult)

const sum = await api.math.grade1.add(5, 3)
console.log("5 + 3 =", sum)

const product = await api.math.grade2.multiply(4, 6)
console.log("4 * 6 =", product)

console.log("\n=== Inspector Stats ===")
console.log("Total events:", memoryBackend.getStats().totalMessages)
console.log("Method counts:", Object.fromEntries(memoryBackend.getStats().methodCounts))

console.log("\n=== Recent echo calls ===")
const echoCalls = memoryBackend.query({ method: "echo" })
echoCalls.forEach((e) => {
	console.log(`  ${e.direction}: ${JSON.stringify(e.message.args)}`)
})

console.log("\n=== Log file ===")
console.log("Events saved to ./inspector.log")

childProcess.kill()
process.exit(0)
