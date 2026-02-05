import { afterAll, beforeAll, describe, test } from "bun:test"
import { WebSocketServer } from "ws"
import { RPCChannel } from "../mod.ts"
import { WebSocketClientIO, WebSocketServerIO } from "../src/adapters/websocket.ts"
import type { IoInterface } from "../src/interface.ts"

interface BenchmarkAPI {
	echo: (message: string) => Promise<string>
	add: (a: number, b: number) => Promise<number>
	batchAdd: (pairs: Array<[number, number]>) => Promise<number[]>
	noop: () => Promise<undefined>
	ping: () => Promise<number>
}

const PORT = 3002
let wss: WebSocketServer

const benchmarkAPI = {
	echo: async (message: string) => message,
	add: async (a: number, b: number) => a + b,
	batchAdd: async (pairs: Array<[number, number]>) => pairs.map(([a, b]) => a + b),
	noop: async () => undefined,
	ping: async () => Date.now()
}

beforeAll(() => {
	wss = new WebSocketServer({ port: PORT })
	wss.on("connection", (ws: WebSocket) => {
		const serverIO = new WebSocketServerIO(ws)
		new RPCChannel<typeof benchmarkAPI, BenchmarkAPI>(serverIO, { expose: benchmarkAPI })
	})
})

afterAll(() => {
	wss.close()
})

async function runBenchmark(api: BenchmarkAPI, transport: string) {
	const results: {
		transport: string
		sequentialEcho: { calls: number; duration: number; callsPerSecond: number }
		sequentialAdd: { calls: number; duration: number; callsPerSecond: number }
		concurrentEcho: { calls: number; duration: number; callsPerSecond: number }
		concurrentAdd: { calls: number; duration: number; callsPerSecond: number }
		batchAdd: { calls: number; duration: number; callsPerSecond: number; batchSize: number }
		latency: { min: number; max: number; avg: number; p99: number }
	} = {
		transport,
		sequentialEcho: { calls: 0, duration: 0, callsPerSecond: 0 },
		sequentialAdd: { calls: 0, duration: 0, callsPerSecond: 0 },
		concurrentEcho: { calls: 0, duration: 0, callsPerSecond: 0 },
		concurrentAdd: { calls: 0, duration: 0, callsPerSecond: 0 },
		batchAdd: { calls: 0, duration: 0, callsPerSecond: 0, batchSize: 0 },
		latency: { min: 0, max: 0, avg: 0, p99: 0 }
	}

	const SEQUENTIAL_CALLS = 10000
	const CONCURRENT_CALLS = 10000
	const BATCH_SIZE = 100
	const LATENCY_SAMPLES = 1000

	const sequentialEchoStart = performance.now()
	for (let i = 0; i < SEQUENTIAL_CALLS; i++) {
		await api.echo(`message-${i}`)
	}
	const sequentialEchoEnd = performance.now()
	results.sequentialEcho = {
		calls: SEQUENTIAL_CALLS,
		duration: sequentialEchoEnd - sequentialEchoStart,
		callsPerSecond: (SEQUENTIAL_CALLS / (sequentialEchoEnd - sequentialEchoStart)) * 1000
	}

	const sequentialAddStart = performance.now()
	for (let i = 0; i < SEQUENTIAL_CALLS; i++) {
		await api.add(i, i + 1)
	}
	const sequentialAddEnd = performance.now()
	results.sequentialAdd = {
		calls: SEQUENTIAL_CALLS,
		duration: sequentialAddEnd - sequentialAddStart,
		callsPerSecond: (SEQUENTIAL_CALLS / (sequentialAddEnd - sequentialAddStart)) * 1000
	}

	const concurrentEchoStart = performance.now()
	await Promise.all(
		Array(CONCURRENT_CALLS)
			.fill(0)
			.map((_, i) => api.echo(`concurrent-${i}`))
	)
	const concurrentEchoEnd = performance.now()
	results.concurrentEcho = {
		calls: CONCURRENT_CALLS,
		duration: concurrentEchoEnd - concurrentEchoStart,
		callsPerSecond: (CONCURRENT_CALLS / (concurrentEchoEnd - concurrentEchoStart)) * 1000
	}

	const concurrentAddStart = performance.now()
	await Promise.all(
		Array(CONCURRENT_CALLS)
			.fill(0)
			.map((_, i) => api.add(i, i + 1))
	)
	const concurrentAddEnd = performance.now()
	results.concurrentAdd = {
		calls: CONCURRENT_CALLS,
		duration: concurrentAddEnd - concurrentAddStart,
		callsPerSecond: (CONCURRENT_CALLS / (concurrentAddEnd - concurrentAddStart)) * 1000
	}

	const batchPairs = Array(BATCH_SIZE)
		.fill(0)
		.map((_, i) => [i, i + 1] as [number, number])
	const batchCalls = Math.floor(SEQUENTIAL_CALLS / BATCH_SIZE)
	const batchAddStart = performance.now()
	for (let i = 0; i < batchCalls; i++) {
		await api.batchAdd(batchPairs)
	}
	const batchAddEnd = performance.now()
	results.batchAdd = {
		calls: batchCalls,
		duration: batchAddEnd - batchAddStart,
		callsPerSecond: (batchCalls / (batchAddEnd - batchAddStart)) * 1000,
		batchSize: BATCH_SIZE
	}

	const latencies: number[] = []
	for (let i = 0; i < LATENCY_SAMPLES; i++) {
		const start = performance.now()
		await api.ping()
		const end = performance.now()
		latencies.push(end - start)
	}
	latencies.sort((a, b) => a - b)
	results.latency = {
		min: latencies[0],
		max: latencies[latencies.length - 1],
		avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
		p99: latencies[Math.floor(latencies.length * 0.99)]
	}

	return results
}

function printResults(
	results: ReturnType<typeof runBenchmark> extends Promise<infer T> ? T : never
) {
	console.log(`\n========== ${results.transport} Benchmark Results ==========`)
	console.log(`\n--- Sequential Operations ---`)
	console.log(
		`Echo: ${results.sequentialEcho.calls.toLocaleString()} calls in ${results.sequentialEcho.duration.toFixed(2)}ms (${Math.round(results.sequentialEcho.callsPerSecond).toLocaleString()} calls/sec)`
	)
	console.log(
		`Add:  ${results.sequentialAdd.calls.toLocaleString()} calls in ${results.sequentialAdd.duration.toFixed(2)}ms (${Math.round(results.sequentialAdd.callsPerSecond).toLocaleString()} calls/sec)`
	)

	console.log(`\n--- Concurrent Operations ---`)
	console.log(
		`Echo: ${results.concurrentEcho.calls.toLocaleString()} calls in ${results.concurrentEcho.duration.toFixed(2)}ms (${Math.round(results.concurrentEcho.callsPerSecond).toLocaleString()} calls/sec)`
	)
	console.log(
		`Add:  ${results.concurrentAdd.calls.toLocaleString()} calls in ${results.concurrentAdd.duration.toFixed(2)}ms (${Math.round(results.concurrentAdd.callsPerSecond).toLocaleString()} calls/sec)`
	)

	console.log(`\n--- Batch Operations ---`)
	console.log(
		`BatchAdd (${results.batchAdd.batchSize} ops/batch): ${results.batchAdd.calls.toLocaleString()} calls in ${results.batchAdd.duration.toFixed(2)}ms (${Math.round(results.batchAdd.callsPerSecond).toLocaleString()} calls/sec)`
	)
	console.log(
		`Effective throughput: ${Math.round(results.batchAdd.callsPerSecond * results.batchAdd.batchSize).toLocaleString()} operations/sec`
	)

	console.log(`\n--- Latency (ping) ---`)
	console.log(`Min: ${results.latency.min.toFixed(3)}ms`)
	console.log(`Avg: ${results.latency.avg.toFixed(3)}ms`)
	console.log(`P99: ${results.latency.p99.toFixed(3)}ms`)
	console.log(`Max: ${results.latency.max.toFixed(3)}ms`)
	console.log(`===========================================\n`)
}

describe("WebSocket Throughput Benchmark", () => {
	test(
		"Benchmark WebSocket RPC throughput",
		async () => {
			const clientIO = new WebSocketClientIO({
				url: `ws://localhost:${PORT}`
			})

			const clientRPC = new RPCChannel<{}, BenchmarkAPI, IoInterface>(clientIO)
			const api = clientRPC.getAPI()

			const results = await runBenchmark(api, "WebSocket")
			printResults(results)

			clientIO.destroy()
		},
		{ timeout: 60000 }
	)
})
