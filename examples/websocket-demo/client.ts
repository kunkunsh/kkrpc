import type { APINested } from "@kksh/demo-api"
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"

const DEFAULT_WS_URL = process.env.KKRPC_WS_URL ?? "ws://127.0.0.1:3001/ws"

export interface WsDemoClientResult {
	echoResult: string
	sum: number
	product: number
	quotient: number
	concurrentResults: [number, number]
	allCorrect: boolean
	elapsedMs: number
}

export async function runWsDemoClient(url = DEFAULT_WS_URL): Promise<WsDemoClientResult> {
	const api = wrap<APINested>(webSocketClientTransport({ url }))

	const echoResult = await api.echo("Hello WebSocket RPC!")
	console.log("Echo:", echoResult)

	const sum = await api.math.grade1.add(5, 3)
	console.log("5 + 3 =", sum)

	const product = await api.math.grade2.multiply(4, 6)
	console.log("4 * 6 =", product)

	const quotient = await api.math.grade3.divide(20, 4)
	console.log("20 / 4 =", quotient)

	const concurrentResults = await Promise.all([
		api.math.grade1.add(10, 20),
		api.math.grade2.multiply(10, 20)
	])
	console.log("Concurrent results:", concurrentResults)

	const start = Date.now()
	const numbers = Array.from({ length: 30 }, () => {
		const a = Math.random()
		const b = Math.random()
		return { a, b, expected: a + b }
	})

	const results = await Promise.all(numbers.map(({ a, b }) => api.math.grade1.add(a, b)))
	const allCorrect = results.every(
		(result, i) => Math.abs(result - numbers[i].expected) < Number.EPSILON
	)
	if (!allCorrect) {
		console.error("Some results were incorrect!")
	} else {
		console.log("All results verified correct")
	}
	const elapsedMs = Date.now() - start
	console.log(`Time taken: ${elapsedMs}ms`)

	return {
		echoResult,
		sum,
		product,
		quotient,
		concurrentResults,
		allCorrect,
		elapsedMs
	}
}

if (import.meta.main) {
	await runWsDemoClient()
}
