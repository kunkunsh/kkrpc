/**
 * Regression tests for RPCChannel behavior that previously caused hangs or wrong responses.
 * These use tiny in-memory transports so the tests focus on channel lifecycle, broadcast fan-out,
 * validation transforms, write failures, and stream transfer handling rather than real adapters.
 */
import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { RPCChannel } from "../src/channel.ts"
import type { IoCapabilities, IoInterface, IoMessage } from "../src/interface.ts"
import { transfer } from "../src/transfer.ts"
import type { RPCValidators } from "../src/validation.ts"

// Minimal in-memory duplex transport used to exercise RPCChannel without real sockets/processes.
class MemoryIO implements IoInterface {
	name: string
	capabilities?: IoCapabilities
	private peer?: MemoryIO
	private messageQueue: Array<string | IoMessage | null> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private errorListeners: Set<(error: Error) => void> = new Set()

	constructor(name: string, capabilities?: IoCapabilities) {
		this.name = name
		this.capabilities = capabilities
	}

	connect(peer: MemoryIO): void {
		this.peer = peer
	}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		} else {
			this.errorListeners.add(listener as (error: Error) => void)
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		} else {
			this.errorListeners.delete(listener as (error: Error) => void)
		}
	}

	read(): Promise<string | IoMessage | null> {
		if (this.messageQueue.length > 0) {
			return Promise.resolve(this.messageQueue.shift() ?? null)
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	write(message: string | IoMessage): Promise<void> {
		this.peer?.receive(message)
		return Promise.resolve()
	}

	destroy(): void {
		this.receive(null)
	}

	receive(message: string | IoMessage | null): void {
		if (message !== null && this.messageListeners.size > 0) {
			this.messageListeners.forEach((listener) => listener(message))
			return
		}

		if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
			return
		}

		this.messageQueue.push(message)
	}
}

// Transport that accepts writes but rejects them asynchronously, matching real adapter failures.
class FailingWriteIO extends MemoryIO {
	constructor(private writeError: Error) {
		super("failing-write-io")
	}

	write(_message: string | IoMessage): Promise<void> {
		return Promise.reject(this.writeError)
	}
}

// Fan-out transport: every write is delivered to every peer, including unrelated APIs.
class BroadcastMemoryIO implements IoInterface {
	capabilities: IoCapabilities = { broadcast: true }
	private messageQueue: Array<string | IoMessage | null> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null

	constructor(
		public name: string,
		private peers: Set<BroadcastMemoryIO>
	) {
		this.peers.add(this)
	}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(_event: "message" | "error", _listener: Function): void {}

	off(_event: "message" | "error", _listener: Function): void {}

	read(): Promise<string | IoMessage | null> {
		if (this.messageQueue.length > 0) {
			return Promise.resolve(this.messageQueue.shift() ?? null)
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	write(message: string | IoMessage): Promise<void> {
		// Broadcast transports intentionally deliver each request to all peers.
		for (const peer of this.peers) {
			peer.receive(message)
		}
		return Promise.resolve()
	}

	destroy(): void {
		this.peers.delete(this)
		this.receive(null)
	}

	receive(message: string | IoMessage | null): void {
		if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
			return
		}

		this.messageQueue.push(message)
	}
}

// Creates a point-to-point transport pair for tests that should have exactly one receiver.
function createMemoryPair(capabilities?: IoCapabilities): [MemoryIO, MemoryIO] {
	const left = new MemoryIO("memory-left", capabilities)
	const right = new MemoryIO("memory-right", capabilities)
	left.connect(right)
	right.connect(left)
	return [left, right]
}

// Broadcast peers that cannot handle a request should stay silent, so the caller times out.
async function expectTimedOut(promise: Promise<unknown>): Promise<void> {
	try {
		await promise
		expect.unreachable("should have rejected")
	} catch (error: unknown) {
		expect(error).toBeInstanceOf(Error)
		if (error instanceof Error) {
			expect(error.message).toContain("timed out")
			expect(error.message).not.toContain("API implementation")
			expect(error.message).not.toContain("Invalid")
		}
	}
}

describe("RPCChannel regressions", () => {
	// Point-to-point transports should report missing expose() immediately, not hang until timeout.
	test("requests received before expose return an error response", async () => {
		type RemoteAPI = { ping(): Promise<string> }
		const [clientIO, serverIO] = createMemoryPair()

		new RPCChannel<Record<string, never>, RemoteAPI>(serverIO)
		const client = new RPCChannel<Record<string, never>, RemoteAPI>(clientIO, { timeout: 200 })

		try {
			await client.getAPI().ping()
			expect.unreachable("should have rejected")
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(Error)
			if (error instanceof Error) {
				expect(error.message).toContain("No API implementation")
			}
		} finally {
			client.destroy()
		}
	})

	// In broadcast mode, a peer with no API should stay silent so another peer can answer.
	test("broadcast transports ignore no-api property and constructor requests", async () => {
		type RemoteAPI = { value: string; Widget: new () => unknown }
		const capabilities: IoCapabilities = { broadcast: true }
		const [clientIO, serverIO] = createMemoryPair(capabilities)

		new RPCChannel<Record<string, never>, RemoteAPI>(serverIO)
		const client = new RPCChannel<Record<string, never>, RemoteAPI>(clientIO, { timeout: 25 })

		try {
			await expectTimedOut(client.getProperty("value"))
			await expectTimedOut(client.setProperty("value", "updated"))
			await expectTimedOut(client.callConstructor("Widget", []))
		} finally {
			client.destroy()
		}
	})

	// An unrelated API peer should not poison the caller with an early method-not-found error.
	test("broadcast transports ignore method misses from unrelated APIs", async () => {
		type RemoteAPI = { ping(): Promise<string> }
		const peers = new Set<BroadcastMemoryIO>()
		const clientIO = new BroadcastMemoryIO("broadcast-client", peers)
		const unrelatedIO = new BroadcastMemoryIO("broadcast-unrelated", peers)
		const serverIO = new BroadcastMemoryIO("broadcast-server", peers)

		// This unrelated peer receives the request first but must not send an error response.
		new RPCChannel<{ other(): Promise<string> }, RemoteAPI>(unrelatedIO, {
			expose: {
				other: async () => "wrong peer"
			}
		})
		new RPCChannel<RemoteAPI, Record<string, never>>(serverIO, {
			expose: {
				ping: async () => {
					await new Promise((resolve) => setTimeout(resolve, 25))
					return "pong"
				}
			}
		})
		const client = new RPCChannel<Record<string, never>, RemoteAPI>(clientIO, { timeout: 200 })

		try {
			expect(await client.getAPI().ping()).toBe("pong")
		} finally {
			client.destroy()
			unrelatedIO.destroy()
			serverIO.destroy()
		}
	})

	// Property lookup misses from unrelated peers should be ignored for the same fan-out reason.
	test("broadcast transports ignore property misses from unrelated APIs", async () => {
		type RemoteAPI = { value: string }
		const peers = new Set<BroadcastMemoryIO>()
		const clientIO = new BroadcastMemoryIO("broadcast-client", peers)
		const unrelatedIO = new BroadcastMemoryIO("broadcast-unrelated", peers)
		const serverIO = new BroadcastMemoryIO("broadcast-server", peers)

		// Only the server has the requested property; unrelated peers should ignore the miss.
		new RPCChannel<{ other: string }, RemoteAPI>(unrelatedIO, {
			expose: { other: "wrong peer" }
		})
		new RPCChannel<RemoteAPI, Record<string, never>>(serverIO, {
			expose: { value: "right peer" }
		})
		const client = new RPCChannel<Record<string, never>, RemoteAPI>(clientIO, { timeout: 200 })

		try {
			expect(await client.getProperty("value")).toBe("right peer")
		} finally {
			client.destroy()
			unrelatedIO.destroy()
			serverIO.destroy()
		}
	})

	// Constructor lookup misses from unrelated peers should not block the matching constructor owner.
	test("broadcast transports ignore constructor misses from unrelated APIs", async () => {
		class Widget {
			kind = "widget"
		}
		type RemoteAPI = { Widget: new () => Widget }
		const peers = new Set<BroadcastMemoryIO>()
		const clientIO = new BroadcastMemoryIO("broadcast-client", peers)
		const unrelatedIO = new BroadcastMemoryIO("broadcast-unrelated", peers)
		const serverIO = new BroadcastMemoryIO("broadcast-server", peers)

		// Constructor misses are also ignored on broadcast so the right peer can answer.
		new RPCChannel<{ Other: new () => object }, RemoteAPI>(unrelatedIO, {
			expose: { Other: class Other {} }
		})
		new RPCChannel<RemoteAPI, Record<string, never>>(serverIO, {
			expose: { Widget }
		})
		const client = new RPCChannel<Record<string, never>, RemoteAPI>(clientIO, { timeout: 200 })

		try {
			expect(await client.callConstructor("Widget", [])).toEqual({ kind: "widget" })
		} finally {
			client.destroy()
			unrelatedIO.destroy()
			serverIO.destroy()
		}
	})

	// read() returning null is transport EOF; pending calls must fail now, not after timeout.
	test("transport EOF rejects pending requests instead of waiting for timeout", async () => {
		type RemoteAPI = { ping(): Promise<string> }
		const clientIO = new MemoryIO("closing-io")
		const client = new RPCChannel<Record<string, never>, RemoteAPI>(clientIO, { timeout: 200 })
		const pending = client.getAPI().ping()

		clientIO.receive(null)

		try {
			await pending
			expect.unreachable("should have rejected")
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(Error)
			if (error instanceof Error) {
				expect(error.message).toContain("closed")
				expect(error.message).not.toContain("timed out")
			}
		}
	})

	// Once EOF is observed, future calls should fail synchronously through the returned Promise.
	test("calls made after transport EOF reject immediately", async () => {
		type RemoteAPI = { ping(): Promise<string> }
		const clientIO = new MemoryIO("already-closed-io")
		const client = new RPCChannel<Record<string, never>, RemoteAPI>(clientIO, { timeout: 200 })

		clientIO.receive(null)
		await new Promise((resolve) => setTimeout(resolve, 0))

		try {
			await client.getAPI().ping()
			expect.unreachable("should have rejected")
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(Error)
			if (error instanceof Error) {
				expect(error.message).toContain("closed")
				expect(error.message).not.toContain("timed out")
			}
		}
	})

	// Async write() rejection should reject the RPC caller instead of leaving a pending request.
	test("write failures reject the pending RPC call", async () => {
		type RemoteAPI = { ping(): Promise<string> }
		const client = new RPCChannel<Record<string, never>, RemoteAPI>(
			new FailingWriteIO(new Error("write failed intentionally")),
			{ timeout: 200 }
		)

		try {
			await client.getAPI().ping()
			expect.unreachable("should have rejected")
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(Error)
			if (error instanceof Error) {
				expect(error.message).toContain("write failed intentionally")
			}
		} finally {
			client.destroy()
		}
	})

	// Input schemas can coerce values; handlers should receive the transformed value.
	test("input validation transforms are passed to handlers", async () => {
		type CoerceAPI = { double(value: unknown): Promise<{ valueType: string; doubled: number }> }
		const [clientIO, serverIO] = createMemoryPair()
		// z.coerce.number() should transform "21" before the handler sees it.
		const validators: RPCValidators<CoerceAPI> = {
			double: {
				input: z.tuple([z.coerce.number()]),
				output: z.object({ valueType: z.string(), doubled: z.number() })
			}
		}

		new RPCChannel<CoerceAPI, Record<string, never>>(serverIO, {
			expose: {
				double: async (value) => ({
					valueType: typeof value,
					doubled: typeof value === "number" ? value * 2 : 0
				})
			},
			validators
		})
		const client = new RPCChannel<Record<string, never>, CoerceAPI>(clientIO)

		try {
			const result = await client.getAPI().double("21")
			expect(result).toEqual({ valueType: "number", doubled: 42 })
		} finally {
			client.destroy()
		}
	})

	// AsyncIterable chunks need transfer processing too, not only normal method responses.
	test("stream chunks support transferred values", async () => {
		type StreamAPI = { buffers(): AsyncIterable<ArrayBuffer> }
		// Structured-clone transports can carry zero-copy values for each stream chunk.
		const capabilities: IoCapabilities = { structuredClone: true, transfer: true }
		const [clientIO, serverIO] = createMemoryPair(capabilities)

		new RPCChannel<StreamAPI, Record<string, never>>(serverIO, {
			expose: {
				async *buffers() {
					const buffer = new ArrayBuffer(32)
					yield transfer(buffer, [buffer])
				}
			}
		})
		const client = new RPCChannel<Record<string, never>, StreamAPI>(clientIO)

		try {
			const values: ArrayBuffer[] = []
			for await (const value of await client.getAPI().buffers()) {
				values.push(value)
			}

			expect(values).toHaveLength(1)
			expect(values[0]).toBeInstanceOf(ArrayBuffer)
			expect(values[0].byteLength).toBe(32)
		} finally {
			client.destroy()
		}
	})
})
