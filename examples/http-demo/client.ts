import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { HTTPClientIO, RPCChannel } from "kkrpc"

const clientIO = new HTTPClientIO({
	url: "http://localhost:3000/rpc"
})
const clientRPC = new RPCChannel<{}, APINested>(clientIO, {})

const api = clientRPC.getAPI()
const echoResult = await api.echo("Hello RPC!")
console.log("Echo:", echoResult)

// Test math operations
// const sum = await api.math.grade1.add(5, 3)
// console.log("5 + 3 =", sum)
// try {
// 	const quotient = await api.math.grade3.divide(10, 0)
// 	console.log("10 / 3 =", quotient)
// } catch (error) {
// 	if (error instanceof Error && error.message === "Division by zero") {
// 		console.log("Caught division by zero error")
// 	}
// 	console.error("Error:", error)
// }
const product = await api.math.grade2.multiply(4, 6)
console.log("4 * 6 =", product)

// // Test concurrent calls
// const results = await Promise.all([api.math.grade1.add(10, 20), api.math.grade2.multiply(10, 20)])
// console.log("Concurrent results:", results)

// // stress test, run 30 concurrent calls with Promise.all
// const start = Date.now()
// const numbers = Array.from({ length: 30 }, () => {
// 	const a = Math.random()
// 	const b = Math.random()
// 	return { a, b, expected: a + b }
// })

// const results2 = await Promise.all(numbers.map(({ a, b }) => api.math.grade1.add(a, b)))

// // Verify results
// const allCorrect = results2.every(
// 	(result, i) => Math.abs(result - numbers[i].expected) < Number.EPSILON
// )
// if (!allCorrect) {
// 	console.error("Some results were incorrect!")
// } else {
// 	console.log("All results verified correct")
// }
// const end = Date.now()
// console.log(`Time taken: ${end - start}ms`)
