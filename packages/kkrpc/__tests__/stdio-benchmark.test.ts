import { spawn } from "child_process"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "bun:test"
import { NodeIo } from "../mod.ts"
import { RPCChannel } from "../src/channel.ts"

interface BenchmarkAPI {
	echo: (message: string) => Promise<string>
	add: (a: number, b: number) => Promise<number>
	batchAdd: (pairs: Array<[number, number]>) => Promise<number[]>
	noop: () => Promise<undefined>
	ping: () => Promise<number>
}

function getProjectRoot(): string {
	const fileUrl = new URL(import.meta.url).pathname
	const folderPath = path.dirname(path.dirname(fileUrl))
	return folderPath
}

const projectRoot = getProjectRoot()
const testsPath = path.join(projectRoot, "__tests__")

async function runBenchmark(worker: ChildProcessWithoutNullStreams, runtime: string) {
	const io = new NodeIo(worker.stdout, worker.stdin)
	const rpc = new RPCChannel<{}, BenchmarkAPI>(io)
	const api = rpc.getAPI()

	const results: {
		runtime: string
		sequentialEcho: { calls: number; duration: number; callsPerSecond: number }
		sequentialAdd: { calls: number; duration: number; callsPerSecond: number }
		concurrentEcho: { calls: number; duration: number; callsPerSecond: number }
		concurrentAdd: { calls: number; duration: number; callsPerSecond: number }
		batchAdd: { calls: number; duration: number; callsPerSecond: number; batchSize: number }
		latency: { min: number; max: number; avg: number; p99: number }
	} = {
		runtime,
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

	worker.kill()

	return results
}

function printResults(
	results: ReturnType<typeof runBenchmark> extends Promise<infer T> ? T : never
) {
	console.log(`\n========== ${results.runtime} Benchmark Results ==========`)
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

describe("Stdio Adapter Throughput Benchmark", () => {
	test(
		"Benchmark Node.js stdio adapter",
		async () => {
			const jsScriptPath = path.join(testsPath, "scripts/benchmark-api.js")
			if (!fs.existsSync(jsScriptPath)) {
				await Bun.build({
					entrypoints: [path.join(testsPath, "scripts/benchmark-api.ts")],
					outdir: path.join(testsPath, "scripts"),
					target: "node",
					minify: true
				})
			}
			const worker = spawn("node", [jsScriptPath])
			const results = await runBenchmark(worker, "Node.js")
			printResults(results)
		},
		{ timeout: 30000 }
	)

	test(
		"Benchmark Bun stdio adapter",
		async () => {
			const worker = spawn("bun", [path.join(testsPath, "scripts/benchmark-api.ts")])
			const results = await runBenchmark(worker, "Bun")
			printResults(results)
		},
		{ timeout: 30000 }
	)

	test(
		"Benchmark Deno stdio adapter",
		async () => {
			const worker = spawn("deno", [
				"run",
				"-A",
				path.join(testsPath, "scripts/deno-benchmark-api.ts")
			])
			const results = await runBenchmark(worker, "Deno")
			printResults(results)
		},
		{ timeout: 30000 }
	)
})
