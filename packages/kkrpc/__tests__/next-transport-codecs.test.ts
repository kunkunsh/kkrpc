import { describe, expect, test } from "bun:test"

import { jsonCodec, jsonLineCodec, objectCodec } from "../next-codecs.ts"
import { createTransport, type Platform } from "../next-transport.ts"
import type { RPCMessage } from "../next.ts"

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

describe("next transport codecs", () => {
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

	test("jsonLineCodec adds newline framing and decodes newline-framed JSON", () => {
		const codec = jsonLineCodec<RPCMessage>()
		const message: RPCMessage = { t: "cb", id: "callback", a: ["value"] }

		const wire = codec.encode(message)

		expect(wire).toBe(`${JSON.stringify(message)}\n`)
		expect(codec.decode(wire)).toEqual(message)
		expect(codec.capabilities?.transfer).toBe(false)
	})

	test("createTransport composes platform and codec", () => {
		const platform = new StringPlatform()
		const transport = createTransport<RPCMessage, string>({ platform, codec: jsonCodec<RPCMessage>() })
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
})
