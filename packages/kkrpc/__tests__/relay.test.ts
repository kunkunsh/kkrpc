import { describe, expect, test } from "bun:test"
import type { IoMessage } from "../src/interface.ts"
import { createRelay } from "../src/relay.ts"

describe("Transparent Relay", () => {
	test("should forward messages from A to B", async () => {
		const a = new MockIo("A")
		const b = new MockIo("B")

		const relay = createRelay(a, b)

		const message = "Hello from A"
		a.simulateMessage(message)

		// Wait for async relay
		await delay(10)

		expect(b.getReceivedMessages()).toContain(message)

		relay.destroy()
	})

	test("should forward messages from B to A", async () => {
		const a = new MockIo("A")
		const b = new MockIo("B")

		const relay = createRelay(a, b)

		const message = "Hello from B"
		b.simulateMessage(message)

		await delay(10)

		expect(a.getReceivedMessages()).toContain(message)

		relay.destroy()
	})

	test("should support multiple messages", async () => {
		const a = new MockIo("A")
		const b = new MockIo("B")

		const relay = createRelay(a, b)

		a.simulateMessage("msg1")
		a.simulateMessage("msg2")
		b.simulateMessage("msg3")

		await delay(10)

		expect(b.getReceivedMessages()).toContain("msg1")
		expect(b.getReceivedMessages()).toContain("msg2")
		expect(a.getReceivedMessages()).toContain("msg3")

		relay.destroy()
	})

	test("should cleanup on destroy", () => {
		const a = new MockIo("A")
		const b = new MockIo("B")

		const relay = createRelay(a, b)

		expect(a.listenerCount()).toBe(1)
		expect(b.listenerCount()).toBe(1)

		relay.destroy()

		expect(a.listenerCount()).toBe(0)
		expect(b.listenerCount()).toBe(0)
	})

	test("should stop forwarding after destroy", async () => {
		const a = new MockIo("A")
		const b = new MockIo("B")

		const relay = createRelay(a, b)

		a.simulateMessage("before")
		await delay(5)
		expect(b.getReceivedMessages().length).toBe(1)

		relay.destroy()

		a.simulateMessage("after")
		await delay(5)
		expect(b.getReceivedMessages().length).toBe(1)
	})

	test("should handle bidirectional flow", async () => {
		const a = new MockIo("A")
		const b = new MockIo("B")

		const relay = createRelay(a, b)

		// A -> B
		a.simulateMessage("ping")
		await delay(5)
		expect(b.getReceivedMessages()).toContain("ping")

		// B -> A
		b.simulateMessage("pong")
		await delay(5)
		expect(a.getReceivedMessages()).toContain("pong")

		relay.destroy()
	})
})

class MockIo {
	name: string
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private errorListeners: Set<(error: Error) => void> = new Set()
	private receivedMessages: string[] = []

	constructor(name: string) {
		this.name = name
	}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			this.errorListeners.add(listener as (error: Error) => void)
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			this.errorListeners.delete(listener as (error: Error) => void)
		}
	}

	read(): Promise<string | null> {
		return Promise.resolve(null)
	}

	write(message: string | IoMessage): Promise<void> {
		const msg = typeof message === "string" ? message : JSON.stringify(message.data)
		this.receivedMessages.push(msg)
		return Promise.resolve()
	}

	simulateMessage(message: string): void {
		this.messageListeners.forEach((listener) => listener(message))
	}

	getReceivedMessages(): string[] {
		return [...this.receivedMessages]
	}

	listenerCount(): number {
		return this.messageListeners.size
	}

	destroy(): void {
		this.messageListeners.clear()
		this.errorListeners.clear()
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
