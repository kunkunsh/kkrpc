import { spawn } from "child_process"
import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { RPCChannel } from "kkrpc"
import { consoleBackend, createInspector, MemoryBackend } from "kkrpc/inspector"
import { stdioJsonTransport } from "kkrpc/stdio"

const memoryBackend = new MemoryBackend()

const inspector = createInspector({
	backends: [consoleBackend(true), memoryBackend],
	options: {
		trackLatency: true
	}
})

const childProcess = spawn("bun", ["run", "server.ts"], {
	stdio: ["pipe", "pipe", "inherit"]
})

const transport = stdioJsonTransport({
	readable: childProcess.stdout!,
	writable: childProcess.stdin!
})

const rpc = new RPCChannel<APINested, APINested>(transport, {
	plugins: [inspector.plugin("client-session")]
})
const api = rpc.getAPI()

console.log("\n=== Making RPC calls ===\n")

const echoResult = await api.echo("Hello Inspector!")
console.log("Echo result:", echoResult)

const sum = await api.math.grade1.add(5, 3)
console.log("5 + 3 =", sum)

const product = await api.math.grade2.multiply(4, 6)
console.log("4 * 6 =", product)

console.log("\n=== Inspector Stats ===")
console.log("Total events:", inspector.getStats().totalMessages)
console.log("Method counts:", Object.fromEntries(inspector.getStats().methodCounts))

console.log("\n=== Recent echo calls ===")
const echoCalls = memoryBackend.query().filter((event) => {
	return event.message.t === "q" && event.message.p.join(".") === "echo"
})
echoCalls.forEach((e) => {
	console.log(`  ${e.direction}: ${e.message.t === "q" ? JSON.stringify(e.message.a ?? []) : "[]"}`)
})

rpc.destroy()
childProcess.kill()
process.exit(0)
