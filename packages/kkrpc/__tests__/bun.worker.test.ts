import { expect, test } from "bun:test"
import { RPCChannel, transfer, WorkerParentIO, type IoInterface } from "../mod.ts"
import { apiMethods, type API } from "./scripts/api.ts"

function createRpc() {
	const worker = new Worker(new URL("./scripts/worker.ts", import.meta.url).href, {
		type: "module"
	})
	const io = new WorkerParentIO(worker)
	const rpc = new RPCChannel<API, API, IoInterface>(io, { expose: apiMethods })
	const api = rpc.getAPI()
	return { worker, io, rpc, api }
}

test("Bun Worker", async () => {
	const { io, api } = createRpc()
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

test("Bun worker supports transferable buffers", async () => {
	const { io, api } = createRpc()
	const buffer = new Uint8Array([1, 2, 3, 4])
	const byteLength = buffer.byteLength

	const length = await api.processBuffer(transfer(buffer.buffer, [buffer.buffer]))
	expect(length).toBe(byteLength)
	expect(buffer.byteLength).toBe(0)

	const remoteBuffer = await api.createBuffer(512)
	expect(remoteBuffer).toBeInstanceOf(ArrayBuffer)
	expect(remoteBuffer.byteLength).toBe(512)

	io.destroy()
})
