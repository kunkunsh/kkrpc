import { describe, expect, test } from "bun:test"

import { dispose, expose, wrap, type RPCMessage } from "../next.ts"
import { ioTransport } from "../next-io.ts"
import type { IoCapabilities, IoInterface, IoMessage } from "../src/interface.ts"
import type { WireEnvelope } from "../src/serialization.ts"

interface API {
	add(a: number, b: number): Promise<number>
}

class TestIO implements IoInterface {
	name: string
	capabilities?: IoCapabilities
	peer?: TestIO
	signalDestroyCount = 0
	destroyCount = 0
	writes: Array<string | IoMessage> = []
	private queue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null

	constructor(name: string, capabilities?: IoCapabilities) {
		this.name = name
		this.capabilities = capabilities
	}

	pushIncoming(message: string | IoMessage): void {
		if (this.resolveRead) {
			const resolve = this.resolveRead
			this.resolveRead = null
			resolve(message)
			return
		}
		this.queue.push(message)
	}

	read(): Promise<string | IoMessage | null> {
		if (this.queue.length > 0) return Promise.resolve(this.queue.shift() ?? null)
		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	write(message: string | IoMessage): Promise<void> {
		this.writes.push(message)
		queueMicrotask(() => this.peer?.pushIncoming(message))
		return Promise.resolve()
	}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(): void {}

	off(event: "message" | "error", listener: Function): void
	off(): void {}

	destroy(): void {
		this.destroyCount++
		if (this.resolveRead) {
			const resolve = this.resolveRead
			this.resolveRead = null
			resolve(null)
		}
	}

	signalDestroy(): void {
		this.signalDestroyCount++
	}
}

function createPair(capabilities?: IoCapabilities) {
	const client = new TestIO("client", capabilities)
	const server = new TestIO("server", capabilities)
	client.peer = server
	server.peer = client
	return { client, server }
}

describe("kkrpc/next io bridge", () => {
	test("adapts classic string IoInterface instances into next transports", async () => {
		const { client, server } = createPair()
		const controller = expose({ add: async (a: number, b: number) => a + b }, ioTransport(server))
		const api = wrap<API>(ioTransport(client))

		try {
			expect(await api.add(2, 3)).toBe(5)
		} finally {
			dispose(api)
			controller.dispose()
		}
	})

	test("copies broadcast capability and disables transfer", () => {
		const transport = ioTransport(new TestIO("broadcast", { broadcast: true, transfer: true }))

		expect(transport.capabilities).toEqual({ objectMode: false, transfer: false, broadcast: true })
	})

	test("does not deliver messages after unsubscribe", async () => {
		const io = new TestIO("single")
		const transport = ioTransport(io)
		const received: RPCMessage[] = []
		const unsubscribe = transport.subscribe((message) => received.push(message))

		io.pushIncoming(JSON.stringify({ t: "r", id: "1", v: "first" }))
		await new Promise((resolve) => setTimeout(resolve, 0))
		unsubscribe()
		io.pushIncoming(JSON.stringify({ t: "r", id: "2", v: "second" }))
		await new Promise((resolve) => setTimeout(resolve, 0))
		transport.close?.()

		expect(received).toEqual([{ t: "r", id: "1", v: "first" }])
	})

	test("reports unsupported object-mode IoMessage values", async () => {
		const io = new TestIO("structured")
		const errors: Error[] = []
		const transport = ioTransport(io, { onError: (error) => errors.push(error) })
		transport.subscribe(() => {})
		const envelope: WireEnvelope = {
			version: 2,
			encoding: "object",
			payload: { type: "request", id: "1", method: "ping", args: [], callbackIds: [] }
		}

		io.pushIncoming({ data: envelope })
		await new Promise((resolve) => setTimeout(resolve, 0))
		transport.close?.()

		expect(errors).toHaveLength(1)
		expect(errors[0].message).toContain("only supports string")
	})

	test("close defaults to signalDestroy then destroy", () => {
		const io = new TestIO("closable")
		const transport = ioTransport(io)

		transport.close?.()

		expect(io.signalDestroyCount).toBe(1)
		expect(io.destroyCount).toBe(1)
	})
})
