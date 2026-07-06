import { describe, expect, test } from "bun:test"
import { RPCChannel, RPCTransportClosedError } from "../src/entries/mod.ts"
import type { RPCMessage, Transport } from "../src/entries/mod.ts"
import { RPCChannel as StreamingRPCChannel } from "../src/entries/streaming.ts"

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true, remoteRefs: true }
	closed = false
	peer?: MemoryTransport
	sent: RPCMessage[] = []
	private listeners = new Set<(message: RPCMessage) => void>()

	send(message: RPCMessage): void {
		this.sent.push(message)
		const peer = this.peer
		queueMicrotask(() => {
			for (const listener of peer?.listeners ?? []) listener(message)
		})
	}

	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	close(): void {
		this.closed = true
	}
}

class ClosableMemoryTransport extends MemoryTransport {
	private closeListeners = new Set<(reason?: Error) => void>()

	onClose(listener: (reason?: Error) => void): () => void {
		this.closeListeners.add(listener)
		return () => this.closeListeners.delete(listener)
	}

	emitClose(reason?: Error): void {
		for (const listener of [...this.closeListeners]) listener(reason)
	}
}

function createPair<T extends MemoryTransport>(factory: () => T): [T, T] {
	const a = factory()
	const b = factory()
	a.peer = b
	b.peer = a
	return [a, b]
}

interface ServerAPI {
	hang(): Promise<never>
	echo(value: string): Promise<string>
	numbers(count: number): AsyncIterable<number>
}

const serverImpl = {
	hang: () => new Promise<never>(() => {}),
	echo: (value: string) => value,
	async *numbers(count: number) {
		for (let i = 0; i < count; i++) yield i
	}
}

describe("transport connection lifecycle", () => {
	test("in-flight requests reject with RPCTransportClosedError on close", async () => {
		const [clientT, serverT] = createPair(() => new ClosableMemoryTransport())
		const client = new RPCChannel<object, ServerAPI>(clientT, {})
		new RPCChannel(serverT, { expose: serverImpl })
		const api = client.getAPI()

		const pending = api.hang()
		const reason = new Error("boom")
		clientT.emitClose(reason)

		let caught: unknown
		try {
			await pending
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(RPCTransportClosedError)
		expect((caught as Error).name).toBe("RPCTransportClosedError")
		expect((caught as Error & { cause?: unknown }).cause).toBe(reason)
	})

	test("requests after close fail fast without sending a message", async () => {
		const [clientT, serverT] = createPair(() => new ClosableMemoryTransport())
		const client = new RPCChannel<object, ServerAPI>(clientT, {})
		new RPCChannel(serverT, { expose: serverImpl })
		const api = client.getAPI()

		clientT.emitClose()
		clientT.sent.length = 0
		await expect(api.echo("x")).rejects.toBeInstanceOf(RPCTransportClosedError)
		expect(clientT.sent).toHaveLength(0)
	})

	test("onClose option fires once and a throwing handler does not break the channel", async () => {
		const [clientT, serverT] = createPair(() => new ClosableMemoryTransport())
		let calls = 0
		let seenReason: Error | undefined
		const client = new RPCChannel<object, ServerAPI>(clientT, {
			onClose: (reason) => {
				calls++
				seenReason = reason
				throw new Error("handler blew up")
			}
		})
		new RPCChannel(serverT, { expose: serverImpl })
		client.getAPI()

		const reason = new Error("dropped")
		expect(() => clientT.emitClose(reason)).not.toThrow()
		clientT.emitClose(reason) // second emit is ignored
		expect(calls).toBe(1)
		expect(seenReason).toBe(reason)
	})

	test("close does not destroy the channel; destroy still works afterward", () => {
		const [clientT, serverT] = createPair(() => new ClosableMemoryTransport())
		const client = new RPCChannel<object, ServerAPI>(clientT, {})
		new RPCChannel(serverT, { expose: serverImpl })

		clientT.emitClose()
		expect(clientT.closed).toBe(false) // not auto-destroyed
		client.destroy()
		expect(clientT.closed).toBe(true)
	})

	test("transports without onClose keep timeout behavior (no fail-fast)", async () => {
		const [clientT, serverT] = createPair(() => new MemoryTransport())
		const client = new RPCChannel<object, ServerAPI>(clientT, { timeout: 50 })
		new RPCChannel(serverT, { expose: serverImpl })
		const api = client.getAPI()

		const start = Date.now()
		await expect(api.hang()).rejects.toThrow(/timed out/)
		expect(Date.now() - start).toBeGreaterThanOrEqual(40)
	})

	test("streaming consumers reject when the connection closes", async () => {
		const [clientT, serverT] = createPair(() => new ClosableMemoryTransport())
		const client = new StreamingRPCChannel<object, ServerAPI>(clientT, {})
		new StreamingRPCChannel(serverT, { expose: serverImpl })
		const api = client.getAPI()

		const iterator = api.numbers(1_000_000)[Symbol.asyncIterator]()
		const next = iterator.next()
		clientT.emitClose(new Error("drop"))

		await expect(next).rejects.toBeInstanceOf(RPCTransportClosedError)
	})
})

describe("relay lifecycle", () => {
	test("relay auto-disposes and reports the closing side", async () => {
		const { relayTransport } = await import("../src/entries/relay.ts")
		const [left] = createPair(() => new ClosableMemoryTransport())
		const [right] = createPair(() => new ClosableMemoryTransport())
		let closedSide: string | undefined
		let closedReason: Error | undefined
		const controller = relayTransport(left, right, {
			closeOtherSide: true,
			onClose: (side, reason) => {
				closedSide = side
				closedReason = reason
			}
		})

		const reason = new Error("left dropped")
		left.emitClose(reason)
		expect(closedSide).toBe("left")
		expect(closedReason).toBe(reason)
		expect(right.closed).toBe(true) // closeOtherSide

		// dispose is idempotent
		expect(() => controller.dispose()).not.toThrow()
	})
})
