import type { APINested } from "@kksh/demo-api"
import { wrap } from "kkrpc"
import { httpClientTransport } from "kkrpc/http"

const DEFAULT_RPC_URL = process.env.KKRPC_HTTP_URL ?? "http://127.0.0.1:3000/rpc"

export interface HttpDemoClientResult {
	echoResult: string
	sum: number
	product: number
	concurrentResults: [number, number]
	allCorrect: boolean
	elapsedMs: number
}

export async function runHttpDemoClient(url = DEFAULT_RPC_URL): Promise<HttpDemoClientResult> {
	const api = wrap<APINested>(httpClientTransport({ url }))

	const echoResult = await api.echo("Hello RPC!")
	console.log("Echo:", echoResult)

	const sum = await api.math.grade1.add(5, 3)
	console.log("5 + 3 =", sum)

	const product = await api.math.grade2.multiply(4, 6)
	console.log("4 * 6 =", product)

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
		concurrentResults,
		allCorrect,
		elapsedMs
	}
}

if (import.meta.main) {
	await runHttpDemoClient()
}
