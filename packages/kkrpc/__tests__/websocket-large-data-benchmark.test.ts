import { afterAll, beforeAll, describe, test } from "bun:test"
import { WebSocketServer } from "ws"
import { RPCChannel } from "../mod.ts"
import { WebSocketClientIO, WebSocketServerIO } from "../src/adapters/websocket.ts"
import type { IoInterface } from "../src/interface.ts"

interface LargeDataAPI {
	uploadData: (data: string) => Promise<{ bytesReceived: number; chunks: number }>
	downloadData: (sizeInBytes: number) => Promise<string>
	echoData: (data: string) => Promise<string>
}

const PORT = 3003
let wss: WebSocketServer

const largeDataAPI = {
	uploadData: async (data: string) => ({
		bytesReceived: data.length,
		chunks: 1
	}),
	downloadData: async (sizeInBytes: number) => {
		const chars =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?"
		let result = ""
		for (let i = 0; i < sizeInBytes; i++) {
			result += chars.charAt(Math.floor(Math.random() * chars.length))
		}
		return result
	},
	echoData: async (data: string) => data
}

beforeAll(() => {
	wss = new WebSocketServer({ port: PORT })
	wss.on("connection", (ws: WebSocket) => {
		const serverIO = new WebSocketServerIO(ws)
		new RPCChannel<typeof largeDataAPI, LargeDataAPI>(serverIO, { expose: largeDataAPI })
	})
})

afterAll(() => {
	wss.close()
})

function generateRandomData(sizeInBytes: number): string {
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?"
	let result = ""
	for (let i = 0; i < sizeInBytes; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length))
	}
	return result
}

async function runLargeDataBenchmark(api: LargeDataAPI, transport: string) {
	const results: {
		transport: string
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
	} = {
		transport,
		upload: { dataSize: 0, iterations: 0, totalBytes: 0, duration: 0, mbPerSecond: 0 },
		download: { dataSize: 0, iterations: 0, totalBytes: 0, duration: 0, mbPerSecond: 0 },
		echo: { dataSize: 0, iterations: 0, totalBytes: 0, duration: 0, mbPerSecond: 0 }
	}

	const TEST_SIZES = [
		{ size: 1 * 1024, name: "1KB" },
		{ size: 10 * 1024, name: "10KB" },
		{ size: 100 * 1024, name: "100KB" },
		{ size: 1024 * 1024, name: "1MB" },
		{ size: 10 * 1024 * 1024, name: "10MB" }
	]

	console.log(`\n--- ${transport} Large Data Transfer ---`)

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

	return results
}

describe("WebSocket Large Data Transfer Benchmark", () => {
	test(
		"Benchmark WebSocket large data transfer",
		async () => {
			const clientIO = new WebSocketClientIO({
				url: `ws://localhost:${PORT}`
			})

			const clientRPC = new RPCChannel<{}, LargeDataAPI, IoInterface>(clientIO)
			const api = clientRPC.getAPI()

			await runLargeDataBenchmark(api, "WebSocket")

			clientIO.destroy()
		},
		{ timeout: 120000 }
	)
})
