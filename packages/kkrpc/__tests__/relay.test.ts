import { describe, expect, spyOn, test } from "bun:test"
import type { RPCMessage } from "../src/core/protocol.ts"
import type { Transport } from "../src/core/transport.ts"
import { relayTransport } from "../src/relay.ts"

describe("relayTransport", () => {
	test("forwards messages from left to right", () => {
		const left = new MemoryTransport()
		const right = new MemoryTransport()

		const relay = relayTransport(left, right)
		const message = request("left-to-right")

		left.emit(message)

		expect(right.sent).toEqual([message])
		expect(left.sent).toEqual([])

		relay.dispose()
	})

	test("forwards messages from right to left", () => {
		const left = new MemoryTransport()
		const right = new MemoryTransport()

		const relay = relayTransport(left, right)
		const message = request("right-to-left")

		right.emit(message)

		expect(left.sent).toEqual([message])
		expect(right.sent).toEqual([])

		relay.dispose()
	})

	test("cleans up subscriptions on dispose", () => {
		const left = new MemoryTransport()
		const right = new MemoryTransport()

		const relay = relayTransport(left, right)

		expect(left.listenerCount).toBe(1)
		expect(right.listenerCount).toBe(1)

		relay.dispose()

		expect(left.listenerCount).toBe(0)
		expect(right.listenerCount).toBe(0)
	})

	test("stops forwarding after dispose", () => {
		const left = new MemoryTransport()
		const right = new MemoryTransport()
		const relay = relayTransport(left, right)

		left.emit(request("before"))
		expect(right.sent).toHaveLength(1)

		relay.dispose()
		left.emit(request("after"))

		expect(right.sent).toHaveLength(1)
	})

	test("supports bidirectional flow", () => {
		const left = new MemoryTransport()
		const right = new MemoryTransport()
		const relay = relayTransport(left, right)
		const ping = request("ping")
		const pong = response("ping", "pong")

		left.emit(ping)
		right.emit(pong)

		expect(right.sent).toEqual([ping])
		expect(left.sent).toEqual([pong])

		relay.dispose()
	})

	test("reports sync and async send failures without throwing", async () => {
		const left = new MemoryTransport()
		const right = new MemoryTransport({
			send(message) {
				if (message.t === "q") throw new Error("sync send failed")
				return Promise.reject(new Error("async send failed"))
			}
		})
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})

		try {
			const relay = relayTransport(left, right)

			expect(() => left.emit(request("sync"))).not.toThrow()
			left.emit(response("async", "value"))
			await Promise.resolve()

			expect(errorSpy).toHaveBeenCalledTimes(2)
			expect(String(errorSpy.mock.calls[0]?.[0])).toContain("left-to-right")
			expect(errorSpy.mock.calls[0]?.[1]).toBeInstanceOf(Error)
			expect(String(errorSpy.mock.calls[1]?.[0])).toContain("left-to-right")
			expect(errorSpy.mock.calls[1]?.[1]).toBeInstanceOf(Error)

			relay.dispose()
		} finally {
			errorSpy.mockRestore()
		}
	})
})

class MemoryTransport implements Transport<RPCMessage> {
	readonly sent: RPCMessage[] = []
	private listeners = new Set<(message: RPCMessage) => void>()

	constructor(private options: { send?: (message: RPCMessage) => void | Promise<void> } = {}) {}

	send(message: RPCMessage): void | Promise<void> {
		if (this.options.send) return this.options.send(message)
		this.sent.push(message)
	}

	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	emit(message: RPCMessage): void {
		for (const listener of this.listeners) listener(message)
	}

	get listenerCount(): number {
		return this.listeners.size
	}
}

function request(id: string): RPCMessage {
	return { t: "q", id, op: "call", p: [id] }
}

function response(id: string, value: unknown): RPCMessage {
	return { t: "r", id, v: value }
}
