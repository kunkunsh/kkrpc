/**
 * Middleware demo — WebSocket client.
 *
 * Run the server first: bun run server.ts
 * Then run this:        bun run client.ts
 */
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"
import type { MiddlewareDemoAPI } from "./api.ts"

const PORT = 3100

const transport = webSocketClientTransport({ url: `ws://localhost:${PORT}` })
const api = wrap<MiddlewareDemoAPI>(transport)

console.log("\n=== Auth: access protected method without login ===")
try {
	await api.getSecretData()
	console.log("  ERROR: should have thrown!")
} catch (err: any) {
	console.log(`  Rejected: ${err.message}`)
}

console.log("\n=== Auth: login and access protected method ===")
const loginResult = await api.login("alice", "demo123")
console.log(`  ${loginResult.message}`)

const secret = await api.getSecretData()
console.log(`  Secret: "${secret.classified}"`)
console.log(`  Accessed by: ${secret.accessedBy}`)

console.log("\n=== Auth: bad credentials ===")
try {
	await api.login("bob", "wrong-password")
} catch (err: any) {
	console.log(`  Rejected: ${err.message}`)
}

await new Promise((resolve) => setTimeout(resolve, 1200))

console.log("\n=== Rate limiting: 8 rapid calls (limit is 5/sec) ===")
const rateResults: string[] = []
const rapidCalls = Array.from({ length: 8 }, (_, i) =>
	api
		.ping()
		.then(() => rateResults.push(`#${i + 1} OK`))
		.catch(() => rateResults.push(`#${i + 1} REJECTED`))
)
await Promise.all(rapidCalls)
for (const result of rateResults) console.log(`  ${result}`)

await new Promise((resolve) => setTimeout(resolve, 1200))

console.log("\n=== Regular RPC call ===")
console.log(`  ping -> ${await api.ping()}`)

console.log("\n=== Countdown as an explicit result array ===")
for (const n of await api.countdown(5)) console.log(`  ${n}...`)
console.log("  Liftoff!")

console.log("\n=== Logs as an explicit result array ===")
for (const entry of await api.getLogs("api-gateway", 8)) {
	const color =
		entry.level === "ERROR" ? "\x1b[31m" : entry.level === "WARN" ? "\x1b[33m" : "\x1b[0m"
	console.log(`  ${color}[${entry.level}]\x1b[0m ${entry.message}`)
}

console.log("\n=== Task result array ===")
for (const progress of await api.processTask("data-migration")) {
	const bar = "#".repeat(Math.floor(progress.percent / 5)).padEnd(20, ".")
	console.log(`  [${bar}] ${progress.percent}% - ${progress.status}`)
}

console.log("\n=== Task progress via callback ===")
const callbackSteps: string[] = []
await api.processTaskWithProgress("backup", (progress) => {
	callbackSteps.push(`${progress.percent}%`)
	console.log(`  callback: ${progress.percent}% - ${progress.status}`)
})
console.log(`  callback steps: ${callbackSteps.join(" -> ")}`)

console.log("\n=== Task progress via async iterable ===")
for await (const progress of api.streamTask("deploy")) {
	console.log(`  stream: ${progress.percent}% - ${progress.status}`)
}

console.log("\n=== All demos complete ===\n")
transport.close?.()
process.exit(0)
