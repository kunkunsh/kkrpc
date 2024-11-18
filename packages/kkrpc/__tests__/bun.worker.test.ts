import { expect, test } from "bun:test"
import { NodeIo, RPCChannel, WorkerParentIO, type DestroyableIoInterface } from "../mod.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const worker = new Worker(new URL("./scripts/worker.ts", import.meta.url).href, { type: "module" })
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel<API, API, DestroyableIoInterface>(io, { expose: apiMethods })
const api = rpc.getAPI()

test("Bun Worker", async () => {
	for (let i = 0; i < 100; i++) {
		const randInt1 = Math.floor(Math.random() * 100)
		const randInt2 = Math.floor(Math.random() * 100)
		const product = await api.math.grade2.multiply(randInt1, randInt2)
		expect(product).toBe(randInt1 * randInt2)

		const sum = await api.math.grade1.add(randInt1, randInt2)
		expect(sum).toBe(randInt1 + randInt2)
		api.math.grade1.add(randInt1, randInt2, (sum) => {
			expect(sum).toBe(randInt1 + randInt2)
		})
	}
	io.destroy()
})
