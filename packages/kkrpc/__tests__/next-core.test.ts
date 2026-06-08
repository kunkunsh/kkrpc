import { describe, expect, test } from "bun:test"

import { dispose, expose, RPCChannel, transfer, wrap } from "../next.ts"
import type { RPCMessage, Transport } from "../next.ts"

interface RemoteWidget {
	name: string
}

interface RemoteAPI {
	math: {
		factor: number
		add(a: number, b: number): Promise<number>
	}
	config: {
		name: string
	}
	counter: {
		value: number
		getValue(): Promise<number>
	}
	callCallback(callback: (value: string) => void): Promise<string>
	echo(value: string): Promise<string>
	call(): Promise<string>
	Widget: new (name: string) => Promise<RemoteWidget>
	takeBuffer(buffer: ArrayBuffer): Promise<number>
	hang(): Promise<never>
}

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true }
	closed = false
	peer?: MemoryTransport
	postError?: Error
	transfers: Transferable[][] = []
	private listeners = new Set<(message: RPCMessage) => void>()

	send(message: RPCMessage, transfers: Transferable[] = []): void {
		if (this.postError) throw this.postError
		this.transfers.push(transfers)
		queueMicrotask(() => {
			for (const listener of this.peer?.listeners ?? []) listener(message)
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

function createPair(): [MemoryTransport, MemoryTransport] {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return [a, b]
}

function createAPI() {
	return {
		math: {
			factor: 10,
			add(this: { factor: number }, a: number, b: number) {
				return this.factor + a + b
			}
		},
		config: {
			name: "initial"
		},
		counter: {
			value: 1,
			getValue(this: { value: number }) {
				return this.value
			}
		},
		async callCallback(callback: (value: string) => void) {
			callback("from-server")
			return "done"
		},
		echo(value: string) {
			return value
		},
		call() {
			return "remote-call"
		},
		Widget: class Widget {
			constructor(public name: string) {}
		},
		takeBuffer(buffer: ArrayBuffer) {
			return buffer.byteLength
		},
		async hang() {
			return await new Promise<never>(() => {})
		}
	}
}

type LocalAPI = ReturnType<typeof createAPI>

describe("next core RPC", () => {
	test("RPCChannel supports method calls, nested getters, assignment setters, constructors, callback args, and parent-bound method this", async () => {
		const [a, b] = createPair()
		const serverAPI = createAPI()
		const client = new RPCChannel<object, RemoteAPI>(a)
		const server = new RPCChannel<LocalAPI, object>(b, { expose: serverAPI })
		const api = client.getAPI()

		expect(await api.math.add(2, 3)).toBe(15)
		expect(await api.config.name).toBe("initial")
		api.config.name = "updated"
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(serverAPI.config.name).toBe("updated")
		expect(await api.counter.getValue()).toBe(1)
		const widget = await new api.Widget("demo")
		expect(widget.name).toBe("demo")
		let callbackValue = ""
		expect(await api.callCallback((value) => {
			callbackValue = value
		})).toBe("done")
		expect(callbackValue).toBe("from-server")

		client.destroy()
		server.destroy()
	})

	test("wrap, expose, and dispose are shorthand over RPCChannel", () => {
		const [a, b] = createPair()
		const api = wrap<RemoteAPI>(a, { timeout: 10 })
		const controller = expose<LocalAPI, RemoteAPI>(createAPI(), b, { timeout: 10 })

		dispose(api)
		expect(a.closed).toBe(true)
		controller.dispose()
		expect(b.closed).toBe(true)
	})

	test("does not send async responses after destroy", async () => {
		let resolveSlow!: (value: string) => void
		const [a, b] = createPair()
		const client = new RPCChannel<object, { slow(): Promise<string> }>(a)
		const server = new RPCChannel<{ slow(): Promise<string> }, object>(b, {
			expose: {
				async slow() {
					return await new Promise<string>((resolve) => {
						resolveSlow = resolve
					})
				}
			}
		})

		void client.getAPI().slow().catch(() => {})
		await new Promise((resolve) => setTimeout(resolve, 0))
		server.destroy()
		resolveSlow("late")
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(b.transfers).toHaveLength(0)

		client.destroy()
	})

	test("transfers top-level marked values when transport supports transfer", async () => {
		const [a, b] = createPair()
		const client = new RPCChannel<object, RemoteAPI>(a)
		const server = new RPCChannel<LocalAPI, object>(b, { expose: createAPI() })
		const buffer = new ArrayBuffer(8)

		expect(await client.getAPI().takeBuffer(transfer(buffer, [buffer]))).toBe(8)
		expect(a.transfers[0]).toHaveLength(1)

		client.destroy()
		server.destroy()
	})

	test("does not decode user string values with callback prefix as callbacks", async () => {
		const [a, b] = createPair()
		const client = new RPCChannel<object, RemoteAPI>(a)
		const server = new RPCChannel<LocalAPI, object>(b, { expose: createAPI() })

		expect(await client.getAPI().echo("__kkrpc_next_callback__literal")).toBe(
			"__kkrpc_next_callback__literal"
		)

		client.destroy()
		server.destroy()
	})

	test("allows remote API paths named call", async () => {
		const [a, b] = createPair()
		const client = new RPCChannel<object, RemoteAPI>(a)
		const server = new RPCChannel<LocalAPI, object>(b, { expose: createAPI() })

		expect(await client.getAPI().call()).toBe("remote-call")

		client.destroy()
		server.destroy()
	})

	test("does not consume transfer descriptors when transfer is disabled", async () => {
		const [a, b] = createPair()
		const client = new RPCChannel<object, RemoteAPI>(a, { enableTransfer: false })
		const server = new RPCChannel<LocalAPI, object>(b, { expose: createAPI() })
		const buffer = new ArrayBuffer(8)

		expect(await client.getAPI().takeBuffer(transfer(buffer, [buffer]))).toBe(8)
		expect(a.transfers[0]).toHaveLength(0)
		expect(buffer.byteLength).toBe(8)

		client.destroy()
		server.destroy()
	})

	test("rejects timed out requests and write failures", async () => {
		const [timeoutClientTransport, timeoutServerTransport] = createPair()
		const timeoutClient = new RPCChannel<object, RemoteAPI>(timeoutClientTransport, { timeout: 5 })
		const timeoutServer = new RPCChannel<LocalAPI, object>(timeoutServerTransport, {
			expose: createAPI()
		})

		await expect(timeoutClient.getAPI().hang()).rejects.toThrow("timed out")
		timeoutClient.destroy()
		timeoutServer.destroy()

		const [writeClientTransport, writeServerTransport] = createPair()
		const writeClient = new RPCChannel<object, RemoteAPI>(writeClientTransport)
		const writeServer = new RPCChannel<LocalAPI, object>(writeServerTransport, { expose: createAPI() })
		writeClientTransport.postError = new Error("write failed")

		await expect(writeClient.getAPI().math.add(1, 2)).rejects.toThrow("write failed")
		writeClient.destroy()
		writeServer.destroy()
	})

	test("falls back to Math.random IDs when global crypto is unavailable", async () => {
		const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto")
		Object.defineProperty(globalThis, "crypto", {
			configurable: true,
			value: undefined,
			writable: true
		})
		const [a, b] = createPair()
		const client = new RPCChannel<object, { echo(value: string): Promise<string> }>(a)
		const server = new RPCChannel<{ echo(value: string): string }, object>(b, {
			expose: { echo: (value) => value }
		})

		try {
			expect(await client.getAPI().echo("ok")).toBe("ok")
		} finally {
			client.destroy()
			server.destroy()
			if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto)
			else Reflect.deleteProperty(globalThis, "crypto")
		}
	})
})
