/**
 * Streaming + Middleware demo — WebSocket client.
 *
 * Run the server first: bun run server.ts
 * Then run this:        bun run client.ts
 *
 * Demonstrates:
 *   Streaming  — countdown, log tail, progress tracker, concurrent streams
 *   Middleware — auth rejection/success, rate limiting, timing/logging (server-side)
 */
import { RPCChannel, WebSocketClientIO } from "kkrpc"
import type { IoInterface } from "kkrpc"
import type { StreamingMiddlewareAPI } from "./api.ts"

const PORT = 3100

const io = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
const rpc = new RPCChannel<{}, StreamingMiddlewareAPI, IoInterface>(io)
const api = rpc.getAPI()

// ─────────────────────────────────────────────────────────────────────────────
// PART 1: Middleware demos
// ─────────────────────────────────────────────────────────────────────────────

// ─── 1a. Auth — call protected method BEFORE login (should fail) ─────────
console.log("\n=== Auth: access protected method without login ===")
try {
	await api.getSecretData()
	console.log("  ERROR: should have thrown!")
} catch (err: any) {
	console.log(`  Rejected: ${err.message}`)
}

// ─── 1b. Auth — login and retry ──────────────────────────────────────────
console.log("\n=== Auth: login and access protected method ===")
const loginResult = await api.login("alice", "demo123")
console.log(`  ${loginResult.message}`)

const secret = await api.getSecretData()
console.log(`  Secret: "${secret.classified}"`)
console.log(`  Accessed by: ${secret.accessedBy}`)

// ─── 1c. Auth — bad credentials ─────────────────────────────────────────
console.log("\n=== Auth: bad credentials ===")
try {
	await api.login("bob", "wrong-password")
} catch (err: any) {
	console.log(`  Rejected: ${err.message}`)
}

// ─── 1d. Rate limiting — fire rapid calls ────────────────────────────────
// Wait for the sliding window to clear from previous calls (login, getSecretData, etc.)
await new Promise((r) => setTimeout(r, 1200))

console.log("\n=== Rate limiting: 8 rapid calls (limit is 5/sec) ===")
const rateResults: string[] = []
const rapidCalls = Array.from({ length: 8 }, (_, i) =>
	api
		.ping()
		.then(() => rateResults.push(`#${i + 1} OK`))
		.catch(() => rateResults.push(`#${i + 1} REJECTED`))
)
await Promise.all(rapidCalls)
for (const r of rateResults) {
	console.log(`  ${r}`)
}

// Pause so the rate limiter window resets before streaming demos
await new Promise((r) => setTimeout(r, 1200))

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: Streaming demos
// ─────────────────────────────────────────────────────────────────────────────

// ─── 2a. Regular method (still works alongside streaming) ────────────────
console.log("\n=== Regular RPC call ===")
const pong = await api.ping()
console.log(`  ping → ${pong}`)

// ─── 2b. Countdown — finite stream ──────────────────────────────────────
console.log("\n=== Countdown (finite stream) ===")
const countdownStream = await api.countdown(5)
for await (const n of countdownStream) {
	console.log(`  ${n}...`)
}
console.log("  Liftoff!")

// ─── 2c. Log tail — infinite stream, cancelled by consumer ──────────────
console.log("\n=== Log tail (infinite stream, stopping after 8 entries) ===")
let logCount = 0
const logStream = await api.tailLogs("api-gateway")
for await (const entry of logStream) {
	const color =
		entry.level === "ERROR" ? "\x1b[31m" : entry.level === "WARN" ? "\x1b[33m" : "\x1b[0m"
	console.log(`  ${color}[${entry.level}]\x1b[0m ${entry.message}`)
	logCount++
	if (logCount >= 8) break // ← sends stream-cancel to stop the producer
}
console.log("  (stopped tailing)")

// ─── 2d. Progress tracker — finite stream with structured data ──────────
console.log("\n=== Task progress (structured stream) ===")
const progressStream = await api.processTask("data-migration")
for await (const progress of progressStream) {
	const bar = "█".repeat(Math.floor(progress.percent / 5)).padEnd(20, "░")
	console.log(`  [${bar}] ${progress.percent}% — ${progress.status}`)
}

// ─── 2e. Concurrent streams ─────────────────────────────────────────────
console.log("\n=== Concurrent streams ===")
const [task1, task2] = await Promise.all([api.processTask("backup"), api.processTask("cleanup")])

const results1: string[] = []
const results2: string[] = []

await Promise.all([
	(async () => {
		for await (const p of task1) results1.push(`${p.percent}%`)
	})(),
	(async () => {
		for await (const p of task2) results2.push(`${p.percent}%`)
	})()
])
console.log(`  backup  steps: ${results1.join(" → ")}`)
console.log(`  cleanup steps: ${results2.join(" → ")}`)

// ─── Done ────────────────────────────────────────────────────────────────
console.log("\n=== All demos complete ===\n")
io.destroy()
process.exit(0)
