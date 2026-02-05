import { spawn } from "child_process"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "bun:test"
import { NodeIo } from "../mod.ts"
import { RPCChannel } from "../src/channel.ts"

interface LargeDataAPI {
	uploadData: (data: string) => Promise<{ bytesReceived: number; chunks: number }>
	downloadData: (sizeInBytes: number) => Promise<string>
	echoData: (data: string) => Promise<string>
}

function getProjectRoot(): string {
	const fileUrl = new URL(import.meta.url).pathname
	const folderPath = path.dirname(path.dirname(fileUrl))
	return folderPath
}

const projectRoot = getProjectRoot()
const testsPath = path.join(projectRoot, "__tests__")

function generateRandomData(sizeInBytes: number): string {
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?"
	let result = ""
	for (let i = 0; i < sizeInBytes; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length))
	}
	return result
}

async function runLargeDataBenchmark(worker: ChildProcessWithoutNullStreams, runtime: string) {
	const io = new NodeIo(worker.stdout, worker.stdin)
	const rpc = new RPCChannel<{}, LargeDataAPI>(io)
	const api = rpc.getAPI()

	const results: {
		runtime: string
		upload: {
			dataSize: number
			iterations: number
			totalBytes: number
			duration: number
			mbPerSecond: number
		}
		download: {
			dataSize: number
			iterations: number
			totalBytes: number
			duration: number
			mbPerSecond: number
		}
		echo: {
			dataSize: number
			iterations: number
			totalBytes: number
			duration: number
			mbPerSecond: number
		}
		bidirectional: {
			dataSize: number
			iterations: number
			totalBytes: number
			duration: number
			mbPerSecond: number
		}
	} = {
		runtime,
		upload: { dataSize: 0, iterations: 0, totalBytes: 0, duration: 0, mbPerSecond: 0 },
		download: { dataSize: 0, iterations: 0, totalBytes: 0, duration: 0, mbPerSecond: 0 },
		echo: { dataSize: 0, iterations: 0, totalBytes: 0, duration: 0, mbPerSecond: 0 },
		bidirectional: { dataSize: 0, iterations: 0, totalBytes: 0, duration: 0, mbPerSecond: 0 }
	}

	const TEST_SIZES = [
		{ size: 1 * 1024, name: "1KB" },
		{ size: 10 * 1024, name: "10KB" },
		{ size: 100 * 1024, name: "100KB" },
		{ size: 1024 * 1024, name: "1MB" },
		{ size: 10 * 1024 * 1024, name: "10MB" }
	]

	console.log(`\n--- ${runtime} Large Data Transfer ---`)

	for (const { size, name } of TEST_SIZES) {
		const ITERATIONS = size >= 1024 * 1024 ? 10 : 100
		const data = generateRandomData(size)

		const uploadStart = performance.now()
		let totalBytesReceived = 0
		for (let i = 0; i < ITERATIONS; i++) {
			const result = await api.uploadData(data)
			totalBytesReceived += result.bytesReceived
		}
		const uploadEnd = performance.now()
		const uploadDuration = uploadEnd - uploadStart
		const uploadMBps = (totalBytesReceived / (1024 * 1024) / uploadDuration) * 1000

		console.log(
			`Upload ${name}: ${ITERATIONS} x ${(size / 1024).toFixed(0)}KB = ${(totalBytesReceived / (1024 * 1024)).toFixed(2)}MB in ${uploadDuration.toFixed(0)}ms (${uploadMBps.toFixed(2)} MB/s)`
		)

		if (name === "1MB") {
			results.upload = {
				dataSize: size,
				iterations: ITERATIONS,
				totalBytes: totalBytesReceived,
				duration: uploadDuration,
				mbPerSecond: uploadMBps
			}
		}
	}

	for (const { size, name } of TEST_SIZES) {
		const ITERATIONS = size >= 1024 * 1024 ? 10 : 100

		const downloadStart = performance.now()
		let totalBytesDownloaded = 0
		for (let i = 0; i < ITERATIONS; i++) {
			const data = await api.downloadData(size)
			totalBytesDownloaded += data.length
		}
		const downloadEnd = performance.now()
		const downloadDuration = downloadEnd - downloadStart
		const downloadMBps = (totalBytesDownloaded / (1024 * 1024) / downloadDuration) * 1000

		console.log(
			`Download ${name}: ${ITERATIONS} x ${(size / 1024).toFixed(0)}KB = ${(totalBytesDownloaded / (1024 * 1024)).toFixed(2)}MB in ${downloadDuration.toFixed(0)}ms (${downloadMBps.toFixed(2)} MB/s)`
		)

		if (name === "1MB") {
			results.download = {
				dataSize: size,
				iterations: ITERATIONS,
				totalBytes: totalBytesDownloaded,
				duration: downloadDuration,
				mbPerSecond: downloadMBps
			}
		}
	}

	for (const { size, name } of TEST_SIZES.slice(0, 3)) {
		const ITERATIONS = 50
		const data = generateRandomData(size)

		const echoStart = performance.now()
		let totalBytesEchoed = 0
		for (let i = 0; i < ITERATIONS; i++) {
			const echoed = await api.echoData(data)
			totalBytesEchoed += echoed.length
		}
		const echoEnd = performance.now()
		const echoDuration = echoEnd - echoStart
		const echoMBps = ((totalBytesEchoed * 2) / (1024 * 1024) / echoDuration) * 1000

		console.log(
			`Echo ${name}: ${ITERATIONS} x ${(size / 1024).toFixed(0)}KB = ${((totalBytesEchoed * 2) / (1024 * 1024)).toFixed(2)}MB total in ${echoDuration.toFixed(0)}ms (${echoMBps.toFixed(2)} MB/s)`
		)

		if (name === "100KB") {
			results.echo = {
				dataSize: size,
				iterations: ITERATIONS,
				totalBytes: totalBytesEchoed * 2,
				duration: echoDuration,
				mbPerSecond: echoMBps
			}
		}
	}

	worker.kill()
	return results
}

describe("Stdio Large Data Transfer Benchmark", () => {
	test(
		"Benchmark Node.js stdio large data transfer",
		async () => {
			const jsScriptPath = path.join(testsPath, "scripts/large-data-api.js")
			if (!fs.existsSync(jsScriptPath)) {
				await Bun.build({
					entrypoints: [path.join(testsPath, "scripts/large-data-api.ts")],
					outdir: path.join(testsPath, "scripts"),
					target: "node",
					minify: true
				})
			}
			const worker = spawn("node", [jsScriptPath])
			await runLargeDataBenchmark(worker, "Node.js")
		},
		{ timeout: 120000 }
	)

	test(
		"Benchmark Bun stdio large data transfer",
		async () => {
			const worker = spawn("bun", [path.join(testsPath, "scripts/large-data-api.ts")])
			await runLargeDataBenchmark(worker, "Bun")
		},
		{ timeout: 120000 }
	)

	test(
		"Benchmark Deno stdio large data transfer",
		async () => {
			const worker = spawn("deno", [
				"run",
				"-A",
				path.join(testsPath, "scripts/deno-large-data-api.ts")
			])
			await runLargeDataBenchmark(worker, "Deno")
		},
		{ timeout: 120000 }
	)
})
