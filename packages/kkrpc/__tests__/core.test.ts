import { describe, expect, test } from "bun:test"
import { dispose, expose, RPCChannel, transfer, wrap } from "../src/entries/mod.ts"
import { RPCChannel as StreamingRPCChannel } from "../src/entries/streaming.ts"
import type { RPCMessage, RPCStreamRequest, Transport } from "../src/entries/mod.ts"

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
	numbers(count: number): AsyncIterable<number>
	hang(): Promise<never>
}

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true, remoteRefs: true }
	closed = false
	peer?: MemoryTransport
	postError?: Error
	asyncPostError?: Error
	asyncPostErrorDelay = 0
	messages: RPCMessage[] = []
	transfers: Transferable[][] = []
	private listeners = new Set<(message: RPCMessage) => void>()

	send(message: RPCMessage, transfers: Transferable[] = []): void | Promise<void> {
		if (this.postError) throw this.postError
		this.messages.push(message)
		this.transfers.push(transfers)
		queueMicrotask(() => {
			for (const listener of this.peer?.listeners ?? []) listener(message)
		})
		if (this.asyncPostError) {
			return new Promise((_, reject) => {
				setTimeout(() => reject(this.asyncPostError), this.asyncPostErrorDelay)
			})
		}
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
		async *numbers(count: number) {
			for (let i = 0; i < count; i++) {
				yield i
			}
		},
		async hang() {
			return await new Promise<never>(() => {})
		}
	}
}

type LocalAPI = ReturnType<typeof createAPI>

describe("stable core RPC", () => {
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
		expect(
			await api.callCallback((value) => {
				callbackValue = value
			})
		).toBe("done")
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

		void client
			.getAPI()
			.slow()
			.catch(() => {})
		await new Promise((resolve) => setTimeout(resolve, 0))
		server.destroy()
		resolveSlow("late")
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(b.transfers).toHaveLength(0)

		client.destroy()
	})

	test("ignores non-RPC messages instead of responding with an undefined id", async () => {
		const [clientTransport, serverTransport] = createPair()
		const server = new RPCChannel<LocalAPI, object>(serverTransport, { expose: createAPI() })

		clientTransport.send({} as RPCMessage)
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(serverTransport.transfers).toHaveLength(0)

		server.destroy()
	})

	test("rejects remote-reference operation requests with a clear opt-in error", async () => {
		const [clientTransport, serverTransport] = createPair()
		const server = new RPCChannel<LocalAPI, object>(serverTransport, { expose: createAPI() })

		clientTransport.send({
			t: "q",
			id: "ref-request",
			op: "ref",
			p: ["callback-ref", "apply"],
			a: []
		})
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(serverTransport.messages).toHaveLength(1)
		expect(serverTransport.messages[0]).toMatchObject({
			t: "r",
			id: "ref-request",
			e: { m: "Remote reference operations require kkrpc/remote-refs" }
		})

		server.destroy()
	})

	test("invokeRequest rejects remote-reference operations defensively", async () => {
		class TestChannel extends RPCChannel<LocalAPI, object> {
			invokeForTest() {
				return this.invokeRequest({ operation: "ref", path: ["call"], args: [] })
			}
		}
		const [transport] = createPair()
		const channel = new TestChannel(transport, { expose: createAPI() })

		await expect(channel.invokeForTest()).rejects.toThrow(
			"Remote reference operations require kkrpc/remote-refs"
		)

		channel.destroy()
	})

	test("transfers top-level marked values when transport supports transfer", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, RemoteAPI>(a)
		const server = new StreamingRPCChannel<LocalAPI, object>(b, { expose: createAPI() })
		const buffer = new ArrayBuffer(8)

		expect(await client.getAPI().takeBuffer(transfer(buffer, [buffer]))).toBe(8)
		expect(a.transfers[0]).toHaveLength(1)

		client.destroy()
		server.destroy()
	})

	test("does not decode user string values with callback prefix as callbacks", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, RemoteAPI>(a)
		const server = new StreamingRPCChannel<LocalAPI, object>(b, { expose: createAPI() })

		expect(await client.getAPI().echo("__kkrpc_next_callback__literal")).toBe(
			"__kkrpc_next_callback__literal"
		)

		client.destroy()
		server.destroy()
	})

	test("allows remote API paths named call", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, RemoteAPI>(a)
		const server = new StreamingRPCChannel<LocalAPI, object>(b, { expose: createAPI() })

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

	test("streams async iterable results with backpressure", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, RemoteAPI>(a)
		const server = new StreamingRPCChannel<LocalAPI, object>(b, { expose: createAPI() })
		const values: number[] = []

		for await (const value of client.getAPI().numbers(3)) {
			values.push(value)
		}

		expect(values).toEqual([0, 1, 2])

		client.destroy()
		server.destroy()
	})

	test("streams async iterable results with windowed credit instead of per-chunk round trips", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, RemoteAPI>(a)
		const server = new StreamingRPCChannel<LocalAPI, object>(b, { expose: createAPI() })
		const values: number[] = []

		for await (const value of client.getAPI().numbers(40)) {
			values.push(value)
		}

		const pullMessages = a.messages.filter(
			(message): message is RPCStreamRequest => message.t === "sq" && message.op === "pull"
		)
		expect(values).toHaveLength(40)
		expect(pullMessages.length).toBeLessThan(40)
		expect(pullMessages[0]?.n).toBeGreaterThan(1)

		client.destroy()
		server.destroy()
	})

	test("propagates async iterable errors to the remote consumer", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, { fail(): AsyncIterable<number> }>(a)
		const server = new StreamingRPCChannel<{ fail(): AsyncIterable<number> }, object>(b, {
			expose: {
				async *fail() {
					yield 1
					throw new Error("stream failed")
				}
			}
		})
		const iterator = client.getAPI().fail()[Symbol.asyncIterator]()

		expect(await iterator.next()).toEqual({ done: false, value: 1 })
		await expect(iterator.next()).rejects.toThrow("stream failed")

		client.destroy()
		server.destroy()
	})

	test("drains buffered async iterable values before surfacing producer errors", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, { failAfterValues(): AsyncIterable<number> }>(a)
		const server = new StreamingRPCChannel<{ failAfterValues(): AsyncIterable<number> }, object>(b, {
			expose: {
				async *failAfterValues() {
					yield 1
					yield 2
					yield 3
					throw new Error("stream failed after values")
				}
			}
		})
		const iterator = client.getAPI().failAfterValues()[Symbol.asyncIterator]()

		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(await iterator.next()).toEqual({ done: false, value: 1 })
		expect(await iterator.next()).toEqual({ done: false, value: 2 })
		expect(await iterator.next()).toEqual({ done: false, value: 3 })
		await expect(iterator.next()).rejects.toThrow("stream failed after values")

		client.destroy()
		server.destroy()
	})

	test("returns remote async iterators when consumers stop early", async () => {
		const [a, b] = createPair()
		let finalized = false
		const client = new StreamingRPCChannel<
			object,
			{ values(): AsyncIterable<number>; echo(value: string): Promise<string> }
		>(a)
		const server = new StreamingRPCChannel<
			{ values(): AsyncIterable<number>; echo(value: string): Promise<string> },
			object
		>(b, {
			expose: {
				async *values() {
					try {
						yield 1
						yield 2
					} finally {
						finalized = true
					}
				},
				async echo(value) {
					return value
				}
			}
		})

		for await (const value of client.getAPI().values()) {
			expect(value).toBe(1)
			break
		}

		expect(finalized).toBe(true)
		expect(await client.getAPI().echo("still works")).toBe("still works")

		client.destroy()
		server.destroy()
	})

	test("streams empty async iterable results", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, { empty(): AsyncIterable<number> }>(a)
		const server = new StreamingRPCChannel<{ empty(): AsyncIterable<number> }, object>(b, {
			expose: {
				async *empty() {}
			}
		})
		const values: number[] = []

		for await (const value of client.getAPI().empty()) {
			values.push(value)
		}

		expect(values).toEqual([])

		client.destroy()
		server.destroy()
	})

	test("streams concurrent async iterable results independently", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, RemoteAPI>(a)
		const server = new StreamingRPCChannel<LocalAPI, object>(b, { expose: createAPI() })
		const api = client.getAPI()
		const left: number[] = []
		const right: number[] = []

		await Promise.all([
			(async () => {
				for await (const value of api.numbers(3)) left.push(value)
			})(),
			(async () => {
				for await (const value of api.numbers(2)) right.push(value)
			})()
		])

		expect(left).toEqual([0, 1, 2])
		expect(right).toEqual([0, 1])

		client.destroy()
		server.destroy()
	})

	test("streams nested async iterable method results", async () => {
		const [a, b] = createPair()
		type NestedAPI = { nested: { stream(count: number): AsyncIterable<string> } }
		const client = new StreamingRPCChannel<object, NestedAPI>(a)
		const server = new StreamingRPCChannel<NestedAPI, object>(b, {
			expose: {
				nested: {
					async *stream(count) {
						for (let index = 0; index < count; index++) yield `item-${index}`
					}
				}
			}
		})
		const values: string[] = []

		for await (const value of client.getAPI().nested.stream(3)) {
			values.push(value)
		}

		expect(values).toEqual(["item-0", "item-1", "item-2"])

		client.destroy()
		server.destroy()
	})

	test("stream chunks support transferred values", async () => {
		const [a, b] = createPair()
		type StreamAPI = { buffers(): AsyncIterable<ArrayBuffer> }
		const client = new StreamingRPCChannel<object, StreamAPI>(a)
		const server = new StreamingRPCChannel<StreamAPI, object>(b, {
			expose: {
				async *buffers() {
					const buffer = new ArrayBuffer(32)
					yield transfer(buffer, [buffer])
				}
			}
		})
		const values: ArrayBuffer[] = []

		for await (const value of client.getAPI().buffers()) {
			values.push(value)
		}

		expect(values).toHaveLength(1)
		expect(values[0]).toBeInstanceOf(ArrayBuffer)
		expect(values[0].byteLength).toBe(32)
		expect(b.transfers.some((transfers) => transfers.length === 1)).toBe(true)

		client.destroy()
		server.destroy()
	})

	test("streams async iterable arguments to the remote handler", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, { sum(values: AsyncIterable<number>): Promise<number> }>(
			a
		)
		const server = new StreamingRPCChannel<{ sum(values: AsyncIterable<number>): Promise<number> }, object>(
			b,
			{
				expose: {
					async sum(values) {
						let total = 0
						for await (const value of values) total += value
						return total
					}
				}
			}
		)

		async function* values() {
			yield 2
			yield 3
			yield 5
		}

		expect(await client.getAPI().sum(values())).toBe(10)

		client.destroy()
		server.destroy()
	})

	test("closes async iterable arguments when the remote call fails before consuming them", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, { fail(values: AsyncIterable<number>): Promise<void> }>(a)
		const server = new StreamingRPCChannel<{ fail(values: AsyncIterable<number>): Promise<void> }, object>(
			b,
			{
				expose: {
					async fail() {
						throw new Error("boom")
					}
				}
			}
		)
		let finalized = false

		const values: AsyncIterable<number> = {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						return { done: false, value: 1 }
					},
					async return() {
						finalized = true
						return { done: true, value: undefined }
					}
				}
			}
		}

		await expect(client.getAPI().fail(values)).rejects.toThrow("boom")
		expect(finalized).toBe(true)

		client.destroy()
		server.destroy()
	})

	test("rejects remote async iterable reads when the pull message cannot be sent", async () => {
		const [a, b] = createPair()
		const client = new StreamingRPCChannel<object, { numbers(): AsyncIterable<number> }>(a)
		const server = new StreamingRPCChannel<{ numbers(): AsyncIterable<number> }, object>(b, {
			expose: {
				async *numbers() {
					yield 1
				}
			}
		})

		const stream = await client.getAPI().numbers()
		const iterator = stream[Symbol.asyncIterator]()
		a.postError = new Error("pull write failed")

		const result = await Promise.race([
			iterator.next().then(
				() => new Error("next resolved unexpectedly"),
				(error) => error
			),
			new Promise<Error>((resolve) => {
				setTimeout(() => resolve(new Error("next timed out")), 50)
			})
		])
		expect(result).toBeInstanceOf(Error)
		expect(result.message).toBe("pull write failed")

		client.destroy()
		server.destroy()
	})

	test("cleans up local stream state when producer writes fail", async () => {
		const [a, b] = createPair()
		let finalized = false
		const client = new StreamingRPCChannel<object, { numbers(): AsyncIterable<number> }>(a)
		const server = new StreamingRPCChannel<{ numbers(): AsyncIterable<number> }, object>(b, {
			expose: {
				async *numbers() {
					try {
						let index = 0
						while (true) yield index++
					} finally {
						finalized = true
					}
				}
			}
		})
		const localStreams = server as unknown as { localStreams: Map<string, unknown> }

		const stream = await client.getAPI().numbers()
		const iterator = stream[Symbol.asyncIterator]()
		b.postError = new Error("producer write failed")
		void iterator.next().catch(() => {})
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(localStreams.localStreams.size).toBe(0)
		expect(finalized).toBe(true)

		client.destroy()
		server.destroy()
	})

	test("stops pumping local streams when producer writes fail asynchronously", async () => {
		const [a, b] = createPair()
		let finalized = false
		const client = new StreamingRPCChannel<object, { numbers(): AsyncIterable<number> }>(a)
		const server = new StreamingRPCChannel<{ numbers(): AsyncIterable<number> }, object>(b, {
			expose: {
				async *numbers() {
					try {
						let index = 0
						while (true) yield index++
					} finally {
						finalized = true
					}
				}
			}
		})
		const localStreams = server as unknown as { localStreams: Map<string, unknown> }

		const stream = await client.getAPI().numbers()
		const iterator = stream[Symbol.asyncIterator]()
		b.asyncPostError = new Error("async producer write failed")
		b.asyncPostErrorDelay = 5
		void iterator.next().catch(() => {})
		await new Promise((resolve) => setTimeout(resolve, 20))

		const dataChunks = b.messages.filter(
			(message): message is Extract<RPCMessage, { t: "sr" }> => message.t === "sr" && message.d === false
		)
		expect(dataChunks).toHaveLength(1)
		expect(localStreams.localStreams.size).toBe(0)
		expect(finalized).toBe(true)

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
		const writeServer = new RPCChannel<LocalAPI, object>(writeServerTransport, {
			expose: createAPI()
		})
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
