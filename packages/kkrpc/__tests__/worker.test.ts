import { describe, expect, test } from "bun:test"

import { dispose, expose, transfer, wrap } from "../src/entries/mod.ts"
import { workerSelfTransport, workerTransport } from "../src/entries/worker.ts"

interface WorkerAPI {
	add(a: number, b: number): Promise<number>
	takeBuffer(buffer: ArrayBuffer): Promise<number>
	createBuffer(size: number): Promise<ArrayBuffer>
}

describe("worker transport", () => {
	test("exports stable worker helpers", () => {
		expect(typeof expose).toBe("function")
		expect(typeof workerSelfTransport).toBe("function")
	})

	test("wraps a worker object transport", async () => {
		const worker = new Worker(new URL("./scripts/stable-worker.ts", import.meta.url).href, {
			type: "module"
		})
		const api = wrap<WorkerAPI>(workerTransport(worker))

		try {
			expect(await api.add(2, 3)).toBe(5)
		} finally {
			dispose(api)
		}
	})

	test("supports transfer over worker object transport", async () => {
		const worker = new Worker(new URL("./scripts/stable-worker.ts", import.meta.url).href, {
			type: "module"
		})
		const api = wrap<WorkerAPI>(workerTransport(worker))
		const buffer = new ArrayBuffer(16)

		try {
			expect(await api.takeBuffer(transfer(buffer, [buffer]))).toBe(16)
			expect(buffer.byteLength).toBe(0)

			const created = await api.createBuffer(32)
			expect(created.byteLength).toBe(32)
		} finally {
			dispose(api)
		}
	})
})
