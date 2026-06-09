import { describe, expect, test } from "bun:test"
import type { RPCMessage } from "../src/entries/mod.ts"
import { electronIpcTransport } from "../src/entries/electron.ts"
import { tauriShellStdioTransport } from "../src/entries/tauri.ts"

class FakeElectronEndpoint {
	readonly sent: Array<{ channel: string; message: RPCMessage }> = []
	private listeners = new Map<string, Set<(_event: unknown, message: RPCMessage) => void>>()

	send(channel: string, message: RPCMessage): void {
		this.sent.push({ channel, message })
	}

	on(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void {
		const listeners = this.listeners.get(channel) ?? new Set()
		listeners.add(listener)
		this.listeners.set(channel, listeners)
	}

	off(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void {
		this.listeners.get(channel)?.delete(listener)
	}

	emit(channel: string, message: RPCMessage): void {
		for (const listener of this.listeners.get(channel) ?? []) {
			listener({}, message)
		}
	}
}

class FakeTauriStdout {
	private listeners = new Set<(chunk: string) => void>()

	on(event: "data", listener: (chunk: string) => void): void {
		if (event === "data") this.listeners.add(listener)
	}

	off(event: "data", listener: (chunk: string) => void): this {
		if (event === "data") this.listeners.delete(listener)
		return this
	}

	emit(chunk: string): void {
		for (const listener of this.listeners) listener(chunk)
	}
}

class FakeTauriChild {
	readonly writes: string[] = []

	write(chunk: string): Promise<void> {
		this.writes.push(chunk)
		return Promise.resolve()
	}
}

describe("native Electron and Tauri transports", () => {
	test("electronIpcTransport sends and receives RPC messages over a structural IPC endpoint", () => {
		const endpoint = new FakeElectronEndpoint()
		const transport = electronIpcTransport({ endpoint, channel: "rpc" })
		const received: RPCMessage[] = []
		const message: RPCMessage = { t: "q", id: "1", op: "call", p: ["ping"] }

		const unsubscribe = transport.subscribe((incoming) => received.push(incoming))
		transport.send(message)
		endpoint.emit("rpc", message)
		unsubscribe()
		endpoint.emit("rpc", { t: "r", id: "1", v: "ignored" })

		expect(endpoint.sent).toEqual([{ channel: "rpc", message }])
		expect(received).toEqual([message])
		expect(transport.capabilities).toEqual({ objectMode: true, transfer: false })
	})

	test("tauriShellStdioTransport adapts Tauri shell stdout and child stdin as JSON lines", async () => {
		const stdout = new FakeTauriStdout()
		const child = new FakeTauriChild()
		const transport = tauriShellStdioTransport({ stdout, child })
		const received: RPCMessage[] = []
		const message: RPCMessage = { t: "r", id: "1", v: 42 }

		const unsubscribe = transport.subscribe((incoming) => received.push(incoming))
		await transport.send(message)
		stdout.emit(`${JSON.stringify(message)}\n`)
		unsubscribe()

		expect(child.writes).toEqual([`${JSON.stringify(message)}\n`])
		expect(received).toEqual([message])
		expect(transport.capabilities).toEqual({ objectMode: false, transfer: false })
	})
})
