import { describe, expect, test } from "bun:test"
import { RPCCallbackReleasedError, RPCChannel, releaseCallback } from "../src/entries/mod.ts"
import type { RPCMessage, Transport } from "../src/entries/mod.ts"
import { RPCChannel as StreamingRPCChannel } from "../src/entries/streaming.ts"

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true, remoteRefs: true }
	sent: RPCMessage[] = []
	peer?: MemoryTransport
	private listeners = new Set<(message: RPCMessage) => void>()

	send(message: RPCMessage): void {
		this.sent.push(message)
		const peer = this.peer
		queueMicrotask(() => peer?.deliver(message))
	}

	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	close(): void {}

	/** Deliver a message to this transport's own subscribers (simulate inbound). */
	deliver(message: RPCMessage): void {
		for (const listener of [...this.listeners]) listener(message)
	}
}

function createPair(): [MemoryTransport, MemoryTransport] {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return [a, b]
}

interface ServerAPI {
	register(cb: (...args: unknown[]) => void): Promise<boolean>
	callOnce(cb: (value: string) => void): Promise<void>
}

/** Extract callback ids from a recorded `register`/`callOnce` request message. */
function callbackIdOf(message: RPCMessage): string | undefined {
	if (message.t !== "q" || !message.a) return undefined
	const arg = message.a[0] as { __kkrpc_next_arg__?: string; id?: string } | undefined
	return arg?.__kkrpc_next_arg__ === "callback" ? arg.id : undefined
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe("callback lifecycle", () => {
	test("sender reuses one id per function and distinct ids for distinct functions", async () => {
		const [clientT, serverT] = createPair()
		const received: Array<(...args: unknown[]) => void> = []
		const client = new RPCChannel<object, ServerAPI>(clientT, {})
		new RPCChannel(serverT, { expose: { register: (cb: (...args: unknown[]) => void) => received.push(cb) } })
		const api = client.getAPI()

		const handler = () => {}
		for (let i = 0; i < 50; i++) await api.register(handler)
		const ids = clientT.sent.map(callbackIdOf).filter(Boolean)
		expect(ids).toHaveLength(50)
		expect(new Set(ids).size).toBe(1)

		// Two more distinct functions get two more distinct ids (3 unique total).
		await api.register(() => {})
		await api.register(() => {})
		const allIds = clientT.sent.map(callbackIdOf).filter(Boolean) as string[]
		expect(new Set(allIds).size).toBe(3)
	})

	test("receiver decodes the same callback id into an identical facade", async () => {
		const [clientT, serverT] = createPair()
		const received: Array<(...args: unknown[]) => void> = []
		const client = new RPCChannel<object, ServerAPI>(clientT, {})
		new RPCChannel(serverT, { expose: { register: (cb: (...args: unknown[]) => void) => void received.push(cb) } })
		const api = client.getAPI()

		const handler = () => {}
		await api.register(handler)
		await api.register(handler)
		await flush()

		expect(received).toHaveLength(2)
		expect(received[0]).toBe(received[1])
	})

	test("cbr deletes the owner entry so later invocations are dropped", async () => {
		const [clientT, serverT] = createPair()
		let calls = 0
		const client = new RPCChannel<object, ServerAPI>(clientT, {})
		new RPCChannel(serverT, { expose: { register: () => {} } })
		const api = client.getAPI()

		const handler = () => {
			calls++
		}
		await api.register(handler)
		const id = clientT.sent.map(callbackIdOf).find(Boolean) as string

		// The receiver (server) releases the callback: it sends a cbr to the owner (client).
		clientT.deliver({ t: "cbr", ids: [id] })
		// A late invocation from the peer is now dropped.
		clientT.deliver({ t: "cb", id, a: [] })
		await flush()
		expect(calls).toBe(0)
	})

	test("release is self-healing: re-passing the same function works again", async () => {
		const [clientT, serverT] = createPair()
		let calls = 0
		const received: Array<(...args: unknown[]) => void> = []
		const client = new RPCChannel<object, ServerAPI>(clientT, {})
		new RPCChannel(serverT, { expose: { register: (cb: (...args: unknown[]) => void) => void received.push(cb) } })
		const api = client.getAPI()

		const handler = () => {
			calls++
		}
		await api.register(handler)
		const firstId = clientT.sent.map(callbackIdOf).find(Boolean) as string
		clientT.deliver({ t: "cbr", ids: [firstId] })
		await flush()

		// Re-passing the handler assigns a fresh id and re-registers it.
		await api.register(handler)
		const ids = clientT.sent.map(callbackIdOf).filter(Boolean) as string[]
		const secondId = ids[ids.length - 1]
		expect(secondId).not.toBe(firstId)

		clientT.deliver({ t: "cb", id: secondId, a: [] })
		await flush()
		expect(calls).toBe(1)
	})

	test("releaseCallback sends a cbr, is idempotent, and blocks later invocation", async () => {
		const [clientT, serverT] = createPair()
		const received: Array<(...args: unknown[]) => void> = []
		const client = new RPCChannel<object, ServerAPI>(clientT, {})
		new RPCChannel(serverT, { expose: { register: (cb: (...args: unknown[]) => void) => void received.push(cb) } })
		const api = client.getAPI()

		await api.register(() => {})
		await flush()
		const facade = received[0]

		serverT.sent.length = 0
		expect(releaseCallback(facade)).toBe(true)
		expect(releaseCallback(facade)).toBe(true) // idempotent
		expect(releaseCallback({})).toBe(false)
		expect(releaseCallback(() => {})).toBe(false)
		await flush()

		const releases = serverT.sent.filter((m) => m.t === "cbr")
		expect(releases).toHaveLength(1)
		expect(() => facade("x")).toThrow(RPCCallbackReleasedError)
	})

	test("synchronous releases batch into a single cbr message", async () => {
		const [clientT, serverT] = createPair()
		const received: Array<(...args: unknown[]) => void> = []
		const client = new RPCChannel<object, ServerAPI>(clientT, {})
		new RPCChannel(serverT, { expose: { register: (cb: (...args: unknown[]) => void) => void received.push(cb) } })
		const api = client.getAPI()

		const a = () => {}
		const b = () => {}
		const c = () => {}
		await api.register(a)
		await api.register(b)
		await api.register(c)
		await flush()

		serverT.sent.length = 0
		releaseCallback(received[0])
		releaseCallback(received[1])
		releaseCallback(received[2])
		await flush()

		const releases = serverT.sent.filter((m) => m.t === "cbr")
		expect(releases).toHaveLength(1)
		expect((releases[0] as { ids: string[] }).ids).toHaveLength(3)
	})

	test("streaming channel shares the same callback dedup", async () => {
		const [clientT, serverT] = createPair()
		const received: Array<(...args: unknown[]) => void> = []
		const client = new StreamingRPCChannel<object, ServerAPI>(clientT, {})
		new StreamingRPCChannel(serverT, { expose: { register: (cb: (...args: unknown[]) => void) => void received.push(cb) } })
		const api = client.getAPI()

		const handler = () => {}
		await api.register(handler)
		await api.register(handler)
		await flush()
		expect(received).toHaveLength(2)
		expect(received[0]).toBe(received[1])
	})

	test.skipIf(typeof FinalizationRegistry === "undefined")(
		"garbage collection eventually releases a dropped facade",
		async () => {
			const [clientT, serverT] = createPair()
			const client = new RPCChannel<object, ServerAPI>(clientT, {})
			// Server does NOT retain the facade, so it becomes collectable.
			new RPCChannel(serverT, { expose: { callOnce: (cb: (value: string) => void) => cb("hi") } })
			const api = client.getAPI()

			await api.callOnce(() => {})
			await flush()

			serverT.sent.length = 0
			for (let i = 0; i < 5; i++) {
				Bun.gc(true)
				await new Promise((resolve) => setTimeout(resolve, 20))
				if (serverT.sent.some((m) => m.t === "cbr")) break
			}
			expect(serverT.sent.some((m) => m.t === "cbr")).toBe(true)
		}
	)
})
