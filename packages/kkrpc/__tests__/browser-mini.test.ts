import { describe, expect, test } from "bun:test"
import {
	RPCChannel,
	transfer,
	type MiniMessage,
	type MiniTransport,
	WorkerParentIO
} from "../browser-mini-mod.ts"

interface RemoteWidget {
	name: string
}

interface RemoteAPI {
	math: {
		add(a: number, b: number): Promise<number>
		nested: {
			multiply(a: number, b: number): Promise<number>
		}
	}
	callCallback(value: number, callback: (value: number) => void): Promise<void>
	config: {
		name: string
	}
	counter: {
		getValue(): Promise<number>
	}
	Widget: new (name: string) => Promise<RemoteWidget>
	takeBuffer(buffer: ArrayBuffer): Promise<number>
	createBuffer(size: number): Promise<ArrayBuffer>
	hang(): Promise<void>
}

function createRpc(timeout = 1000) {
	const worker = new Worker(new URL("./scripts/browser-mini-worker.ts", import.meta.url).href, {
		type: "module"
	})
	const rpc = new RPCChannel<Record<string, never>, RemoteAPI>(new WorkerParentIO(worker), {
		timeout
	})
	const api = rpc.getAPI()
	return { api, rpc }
}

class TestTransport implements MiniTransport {
	canTransfer = true
	messages: MiniMessage[] = []
	transfers: Transferable[][] = []
	listener?: (message: MiniMessage) => void
	postError?: Error

	post(message: MiniMessage, transfers: Transferable[] = []): void {
		if (this.postError) throw this.postError
		this.messages.push(message)
		this.transfers.push(transfers)
	}

	onMessage(listener: (message: MiniMessage) => void): () => void {
		this.listener = listener
		return () => {
			this.listener = undefined
		}
	}
}

describe("browser-mini RPCChannel", () => {
	test("calls remote methods and nested paths", async () => {
		const { api, rpc } = createRpc()

		try {
			expect(await api.math.add(2, 5)).toBe(7)
			expect(await api.math.nested.multiply(3, 4)).toBe(12)
		} finally {
			rpc.destroy()
		}
	})

	test("invokes callback arguments", async () => {
		const { api, rpc } = createRpc()

		try {
			let completeCall: Promise<void> | undefined
			const callbackResult = new Promise<number>((resolve) => {
				completeCall = api.callCallback(9, resolve)
			})
			const callbackValue = await callbackResult
			await completeCall
			expect(callbackValue).toBe(10)
		} finally {
			rpc.destroy()
		}
	})

	test("gets and sets remote properties", async () => {
		const { api, rpc } = createRpc()

		try {
			expect(await api.config.name).toBe("initial")
			api.config.name = "updated"
			expect(await api.config.name).toBe("updated")
		} finally {
			rpc.destroy()
		}
	})

	test("binds remote method calls to their parent object", async () => {
		const { api, rpc } = createRpc()

		try {
			expect(await api.counter.getValue()).toBe(4)
		} finally {
			rpc.destroy()
		}
	})

	test("calls remote constructors", async () => {
		const { api, rpc } = createRpc()

		try {
			const widget = await new api.Widget("demo")
			expect(widget).toEqual({ name: "demo" })
		} finally {
			rpc.destroy()
		}
	})

	test("transfers marked top-level ArrayBuffers", async () => {
		const { api, rpc } = createRpc()
		const buffer = new ArrayBuffer(16)

		try {
			expect(await api.takeBuffer(transfer(buffer, [buffer]))).toBe(16)
			expect(buffer.byteLength).toBe(0)

			const remoteBuffer = await api.createBuffer(32)
			expect(remoteBuffer).toBeInstanceOf(ArrayBuffer)
			expect(remoteBuffer.byteLength).toBe(32)
		} finally {
			rpc.destroy()
		}
	})

	test("rejects timed out requests", async () => {
		const { api, rpc } = createRpc(10)

		try {
			await expect(api.hang()).rejects.toThrow("timed out after 10ms")
		} finally {
			rpc.destroy()
		}
	})

	test("rejects pending requests on destroy", async () => {
		const { api, rpc } = createRpc()
		const pending = api.hang()

		rpc.destroy()

		await expect(pending).rejects.toThrow("RPC channel destroyed")
	})

	test("rejects request immediately when transport write fails", async () => {
		const transport = new TestTransport()
		transport.postError = new Error("write failed")
		const rpc = new RPCChannel<Record<string, never>, { ping(): Promise<void> }>(transport, {
			timeout: 1000
		})
		const api = rpc.getAPI()

		try {
			await expect(api.ping()).rejects.toThrow("write failed")
			expect(transport.messages).toHaveLength(0)
		} finally {
			rpc.destroy()
		}
	})

	test("uses native function properties instead of remote path segments", () => {
		const transport = new TestTransport()
		const rpc = new RPCChannel<Record<string, never>, RemoteAPI>(transport)
		const api = rpc.getAPI()

		try {
			expect(api.math.add.bind).toBe(Function.prototype.bind)
			expect(api.math.add.call).toBe(Function.prototype.call)
		} finally {
			rpc.destroy()
		}
	})

	test("does not consume transfer descriptors when transfer is disabled", async () => {
		const transport = new TestTransport()
		const rpc = new RPCChannel<Record<string, never>, { takeBuffer(buffer: ArrayBuffer): Promise<void> }>(
			transport,
			{ enableTransfer: false }
		)
		const api = rpc.getAPI()
		const buffer = new ArrayBuffer(8)

		try {
			void api.takeBuffer(transfer(buffer, [buffer])).catch(() => {})
			expect(transport.transfers[0]).toHaveLength(0)
			expect(buffer.byteLength).toBe(8)
		} finally {
			rpc.destroy()
		}
	})
})
