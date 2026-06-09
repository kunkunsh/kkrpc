/**
 * If you see error in this file, it's likely Deno extension is not enabled.
 */
import { assertEquals } from "jsr:@std/assert"
import { apiMethods, type API } from "../__tests__/scripts/api.ts"
import { RPCChannel } from "../mod.ts"
import { workerTransport } from "../worker.ts"

const worker = new Worker(new URL("../__tests__/scripts/worker.ts", import.meta.url).href, {
	type: "module"
})
const rpc = new RPCChannel<API, API>(workerTransport(worker), { expose: apiMethods })
const api = rpc.getAPI()

Deno.test("Call Worker Exposed API", async () => {
	for (let i = 0; i < 100; i++) {
		const randInt1 = Math.floor(Math.random() * 100)
		const randInt2 = Math.floor(Math.random() * 100)
		const product = await api.math.grade2.multiply(randInt1, randInt2)
		assertEquals(product, randInt1 * randInt2)

		const sum = await api.math.grade1.add(randInt1, randInt2)
		assertEquals(sum, randInt1 + randInt2)
		await api.math.grade1.add(randInt1, randInt2, (sum) => {
			assertEquals(sum, randInt1 + randInt2)
		})
	}
	rpc.destroy()
})
