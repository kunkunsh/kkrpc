import { describe, expect, test } from "bun:test"
import { jsonCodec, jsonLineCodec, objectCodec } from "../src/entries/codecs.ts"
import type { RPCMessage } from "../src/entries/mod.ts"
import { createTransport, type Platform } from "../src/entries/transport.ts"
import { chromePortTransport, type ChromePortLike } from "../src/transports/chrome-extension.ts"
import { iframeParentTransport } from "../src/transports/iframe.ts"
import { kafkaTransport } from "../src/transports/kafka.ts"
import { natsTransport } from "../src/transports/nats.ts"
import { rabbitMqTransport } from "../src/transports/rabbitmq.ts"
import { redisStreamsTransport } from "../src/transports/redis-streams.ts"
import { socketIoTransport } from "../src/transports/socketio.ts"
import { stdioJsonTransport } from "../src/transports/stdio.ts"
import { elysiaWebSocketTransport } from "../src/transports/ws-elysia.ts"
import { honoWebSocketTransport } from "../src/transports/ws-hono.ts"
import { webSocketTransport } from "../src/transports/ws.ts"

class StringPlatform implements Platform<string> {
	capabilities = { objectMode: false, transfer: true }
	wires: string[] = []
	listener?: (wire: string) => void

	send(wire: string): void {
		this.wires.push(wire)
	}

	subscribe(listener: (wire: string) => void): () => void {
		this.listener = listener
		return () => {
			this.listener = undefined
		}
	}
}

class ObjectPlatform implements Platform<RPCMessage> {
	capabilities = { objectMode: true }
	messages: RPCMessage[] = []
	transfers: Transferable[][] = []

	send(message: RPCMessage, transfers: Transferable[] = []): void {
		this.messages.push(message)
		this.transfers.push(transfers)
	}

	subscribe(): () => void {
		return () => {}
	}
}

class TransferObjectPlatform extends ObjectPlatform {
	capabilities = { objectMode: true, transfer: true }
}

class ListenerRegistry<TListener> {
	listeners = new Set<TListener>()

	addListener(listener: TListener): void {
		this.listeners.add(listener)
	}

	removeListener(listener: TListener): void {
		this.listeners.delete(listener)
	}
}

describe("stable transport codecs", () => {
	test("objectCodec passes messages through and supports transfer", () => {
		const codec = objectCodec<RPCMessage>()
		const message: RPCMessage = { t: "q", id: "1", op: "call", p: ["add"], a: [1, 2] }

		expect(codec.encode(message)).toBe(message)
		expect(codec.decode(message)).toBe(message)
		expect(codec.capabilities?.transfer).toBe(true)
	})

	test("jsonCodec encodes strict JSON messages and disables transfer", () => {
		const codec = jsonCodec<RPCMessage>()
		const message: RPCMessage = { t: "r", id: "1", v: { ok: true } }

		const wire = codec.encode(message)

		expect(wire).toBe(JSON.stringify(message))
		expect(codec.decode(wire)).toEqual(JSON.parse(wire))
		expect(codec.capabilities?.transfer).toBe(false)
	})

	test("jsonCodec rejects non-JSON-safe values through JSON.stringify", () => {
		const codec = jsonCodec<RPCMessage>()
		const message: RPCMessage = { t: "q", id: "1", op: "call", p: ["value"], a: [1n] }

		expect(() => codec.encode(message)).toThrow()
	})

	test("createTransport without onInvalidFrame lets decode errors propagate", () => {
		const platform = new StringPlatform()
		const transport = createTransport<RPCMessage, string>({
			platform,
			codec: jsonCodec<RPCMessage>()
		})
		transport.subscribe(() => {})

		expect(() => platform.listener?.("not json {")).toThrow()
	})

	test("createTransport with onInvalidFrame drops bad frames and reports them", () => {
		const platform = new StringPlatform()
		const invalid: Array<{ wire: string; error: unknown }> = []
		const received: RPCMessage[] = []
		const transport = createTransport<RPCMessage, string>({
			platform,
			codec: jsonCodec<RPCMessage>(),
			onInvalidFrame: (wire, error) => invalid.push({ wire, error })
		})
		transport.subscribe((message) => received.push(message))

		expect(() => platform.listener?.("not json {")).not.toThrow()
		const valid: RPCMessage = { t: "r", id: "1", v: 42 }
		platform.listener?.(JSON.stringify(valid))

		expect(invalid).toHaveLength(1)
		expect(invalid[0].wire).toBe("not json {")
		expect(invalid[0].error).toBeInstanceOf(Error)
		expect(received).toEqual([valid])
	})

	test("jsonLineCodec adds newline framing and decodes newline-framed JSON", () => {
		const codec = jsonLineCodec<RPCMessage>()
		const message: RPCMessage = {
			t: "q",
			id: "ref",
			op: "ref",
			p: ["callback", "apply"],
			a: ["value"]
		}

		const wire = codec.encode(message)

		expect(wire).toBe(`${JSON.stringify(message)}\n`)
		expect(codec.decode(wire)).toEqual(message)
		expect(codec.capabilities?.transfer).toBe(false)
	})

	test("createTransport composes platform and codec", () => {
		const platform = new StringPlatform()
		const transport = createTransport<RPCMessage, string>({
			platform,
			codec: jsonCodec<RPCMessage>()
		})
		const received: RPCMessage[] = []
		const message: RPCMessage = { t: "q", id: "1", op: "call", p: ["add"], a: [1, 2] }
		const unsubscribe = transport.subscribe((decoded) => received.push(decoded))

		transport.send(message, [new ArrayBuffer(1)])
		platform.listener?.(`${JSON.stringify(message)}\n`)

		expect(platform.wires).toEqual([JSON.stringify(message)])
		expect(received).toEqual([message])
		expect(transport.capabilities?.transfer).toBe(false)

		unsubscribe()

		expect(platform.listener).toBeUndefined()
	})

	test("createTransport strips transfers when platform does not explicitly support transfer", () => {
		const platform = new ObjectPlatform()
		const transport = createTransport<RPCMessage, RPCMessage>({
			platform,
			codec: objectCodec<RPCMessage>()
		})
		const message: RPCMessage = { t: "r", id: "1", v: "ok" }
		const buffer = new ArrayBuffer(1)

		transport.send(message, [buffer])

		expect(transport.capabilities?.transfer).toBe(false)
		expect(platform.messages).toEqual([message])
		expect(platform.transfers).toEqual([[]])
	})

	test("createTransport strips transfers when codec does not explicitly support transfer", () => {
		const platform = new TransferObjectPlatform()
		const codec = {
			encode(message: RPCMessage) {
				return message
			},
			decode(wire: RPCMessage) {
				return wire
			}
		}
		const transport = createTransport<RPCMessage, RPCMessage>({ platform, codec })
		const message: RPCMessage = { t: "r", id: "1", v: "ok" }
		const buffer = new ArrayBuffer(1)

		transport.send(message, [buffer])

		expect(transport.capabilities?.transfer).toBe(false)
		expect(platform.messages).toEqual([message])
		expect(platform.transfers).toEqual([[]])
	})

	test("createTransport forwards transfers when platform and codec explicitly support transfer", () => {
		const platform = new TransferObjectPlatform()
		const transport = createTransport<RPCMessage, RPCMessage>({
			platform,
			codec: objectCodec<RPCMessage>()
		})
		const message: RPCMessage = { t: "r", id: "1", v: "ok" }
		const buffer = new ArrayBuffer(1)

		transport.send(message, [buffer])

		expect(transport.capabilities?.transfer).toBe(true)
		expect(platform.messages).toEqual([message])
		expect(platform.transfers).toEqual([[buffer]])
	})

	test("createTransport applies explicit capability overrides", () => {
		const platform = new TransferObjectPlatform()
		const transport = createTransport<RPCMessage, RPCMessage>({
			platform,
			codec: objectCodec<RPCMessage>(),
			capabilities: { remoteRefs: true, broadcast: true }
		})

		expect(transport.capabilities).toMatchObject({
			objectMode: true,
			transfer: true,
			remoteRefs: true,
			broadcast: true
		})
	})

	test("createTransport transfer capability override disables transfer forwarding", () => {
		const platform = new TransferObjectPlatform()
		const transport = createTransport<RPCMessage, RPCMessage>({
			platform,
			codec: objectCodec<RPCMessage>(),
			capabilities: { transfer: false }
		})
		const message: RPCMessage = { t: "r", id: "1", v: "ok" }
		const buffer = new ArrayBuffer(1)

		transport.send(message, [buffer])

		expect(transport.capabilities?.transfer).toBe(false)
		expect(platform.transfers).toEqual([[]])
	})

	test("concrete bidirectional transports advertise remote reference support", () => {
		const readable = {
			on: (_event: "data", _listener: (chunk: Uint8Array | string) => void) => {},
			off(_event: "data", _listener: (chunk: Uint8Array | string) => void) {
				return this
			}
		}
		const writable = {
			write: (_chunk: string, callback?: (error?: Error | null) => void) => callback?.()
		}
		const socket = {
			send: (_message: string) => {},
			close: () => {}
		}
		const honoSocket = {
			send: (_message: string) => {},
			close: () => {}
		}
		const socketIoSocket = {
			emit: (_event: "kkrpc:message", _message: RPCMessage) => {},
			on: (_event: "kkrpc:message", _listener: (message: RPCMessage) => void) => {},
			off: (_event: "kkrpc:message", _listener: (message: RPCMessage) => void) => {}
		}
		const chromePort: ChromePortLike = {
			postMessage: (_message) => {},
			onMessage: new ListenerRegistry<(message: RPCMessage) => void>(),
			onDisconnect: new ListenerRegistry<() => void>()
		}
		const sourceWindow = new EventTarget() as Window & typeof globalThis

		const transports = [
			stdioJsonTransport({ readable, writable }),
			webSocketTransport(socket),
			honoWebSocketTransport(honoSocket),
			elysiaWebSocketTransport(honoSocket),
			socketIoTransport(socketIoSocket),
			rabbitMqTransport({ localPeerId: "local", remotePeerId: "remote" }),
			natsTransport({
				localPeerId: "local",
				remotePeerId: "remote",
				__connect: async () => ({
					publish: () => {},
					subscribe: () => ({
						async *[Symbol.asyncIterator]() {},
						unsubscribe: () => {}
					}),
					close: async () => {}
				})
			}),
			redisStreamsTransport({ localPeerId: "local", remotePeerId: "remote" }),
			kafkaTransport({
				localPeerId: "local",
				remotePeerId: "remote",
				__client: {
					producer: () => ({
						connect: async () => {},
						disconnect: async () => {},
						send: async () => {}
					}),
					consumer: () => ({
						connect: async () => {},
						disconnect: async () => {},
						subscribe: async () => {},
						run: async () => {}
					}),
					admin: () => ({
						connect: async () => {},
						disconnect: async () => {},
						listTopics: async () => ["kkrpc-topic"],
						createTopics: async () => {}
					})
				}
			}),
			iframeParentTransport(sourceWindow, { sourceWindow }),
			chromePortTransport(chromePort)
		]

		for (const transport of transports) {
			expect(transport.capabilities?.remoteRefs).toBe(true)
			transport.close?.()
		}
	})

	test("broadcast message-bus transports do not advertise remote reference support", () => {
		const kafkaClient = {
			producer: () => ({
				connect: async () => {},
				disconnect: async () => {},
				send: async () => {}
			}),
			consumer: () => ({
				connect: async () => {},
				disconnect: async () => {},
				subscribe: async () => {},
				run: async () => {}
			}),
			admin: () => ({
				connect: async () => {},
				disconnect: async () => {},
				listTopics: async () => ["kkrpc-topic"],
				createTopics: async () => {}
			})
		}
		const transports = [
			rabbitMqTransport({ localPeerId: "local" }),
			natsTransport({
				localPeerId: "local",
				__connect: async () => ({
					publish: () => {},
					subscribe: () => ({
						async *[Symbol.asyncIterator]() {},
						unsubscribe: () => {}
					}),
					close: async () => {}
				})
			}),
			redisStreamsTransport({ localPeerId: "local" }),
			kafkaTransport({ localPeerId: "local", __client: kafkaClient })
		]

		for (const transport of transports) {
			expect(transport.capabilities?.broadcast).toBe(true)
			expect(transport.capabilities?.remoteRefs).toBe(false)
			transport.close?.()
		}
	})
})
