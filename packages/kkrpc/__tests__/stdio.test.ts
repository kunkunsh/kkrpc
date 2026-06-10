import { describe, expect, test } from "bun:test"
import { PassThrough } from "node:stream"

import { dispose, expose, wrap, type RPCMessage } from "../src/entries/mod.ts"
import { nodeStdioTransport, stdioJsonTransport, stdioPlatform } from "../src/entries/stdio.ts"
import type { ReadableLike } from "../src/entries/stdio.ts"

interface TestAPI {
	add(a: number, b: number): Promise<number>
	callCallback(value: string, callback: (value: string) => void): Promise<void>
}

type ReadableLikeRequiresOff = ReadableLike extends {
	off(event: "data", listener: (chunk: Uint8Array | string) => void): unknown
}
	? true
	: false

const readableLikeRequiresOff: ReadableLikeRequiresOff = true

function createStreamPair() {
	const clientToServer = new PassThrough()
	const serverToClient = new PassThrough()

	return {
		client: { readable: serverToClient, writable: clientToServer },
		server: { readable: clientToServer, writable: serverToClient }
	}
}

describe("stdio transport", () => {
	test("exports stable stdio helpers", () => {
		expect(typeof nodeStdioTransport).toBe("function")
	})

	test("supports explicit readable/writable stream pairs", async () => {
		const streams = createStreamPair()
		const controller = expose<TestAPI>(
			{
				async add(a, b) {
					return a + b
				},
				async callCallback(value, callback) {
					callback(value)
				}
			},
			stdioJsonTransport(streams.server)
		)
		const api = wrap<TestAPI>(stdioJsonTransport(streams.client))

		try {
			expect(await api.add(2, 3)).toBe(5)

			let callbackValue = ""
			await api.callCallback("from-server", (value) => {
				callbackValue = value
			})
			expect(callbackValue).toBe("from-server")
		} finally {
			dispose(api)
			controller.dispose()
			expect(streams.client.readable.listenerCount("data")).toBe(0)
			expect(streams.server.readable.listenerCount("data")).toBe(0)
		}
	})

	test("supports multiple independent stream pairs", async () => {
		const streamsA = createStreamPair()
		const streamsB = createStreamPair()
		const controllerA = expose<TestAPI>(
			{
				async add(a, b) {
					return a + b
				},
				async callCallback(value, callback) {
					callback(value)
				}
			},
			stdioJsonTransport(streamsA.server)
		)
		const controllerB = expose<TestAPI>(
			{
				async add(a, b) {
					return a * b
				},
				async callCallback(value, callback) {
					callback(value)
				}
			},
			stdioJsonTransport(streamsB.server)
		)
		const apiA = wrap<TestAPI>(stdioJsonTransport(streamsA.client))
		const apiB = wrap<TestAPI>(stdioJsonTransport(streamsB.client))

		try {
			expect(await apiA.add(2, 3)).toBe(5)
			expect(await apiB.add(2, 3)).toBe(6)
		} finally {
			dispose(apiA)
			dispose(apiB)
			controllerA.dispose()
			controllerB.dispose()
			expect(streamsA.client.readable.listenerCount("data")).toBe(0)
			expect(streamsA.server.readable.listenerCount("data")).toBe(0)
			expect(streamsB.client.readable.listenerCount("data")).toBe(0)
			expect(streamsB.server.readable.listenerCount("data")).toBe(0)
		}
	})

	test("keeps decoder state independent across stdio subscriptions", async () => {
		const readableA = new PassThrough()
		const readableB = new PassThrough()
		const linesA: string[] = []
		const linesB: string[] = []
		const unsubscribeA = stdioPlatform({ readable: readableA, writable: new PassThrough() }).subscribe(
			(line) => linesA.push(line)
		)
		const unsubscribeB = stdioPlatform({ readable: readableB, writable: new PassThrough() }).subscribe(
			(line) => linesB.push(line)
		)
		const encoder = new TextEncoder()
		const lineA = '{"v":"你"}\n'
		const lineB = '{"v":"好"}\n'
		const encodedA = encoder.encode(lineA)
		const splitAt = encoder.encode('{"v":"').length + 1

		try {
			readableA.write(encodedA.slice(0, splitAt))
			readableB.write(encoder.encode(lineB))
			readableA.write(encodedA.slice(splitAt))

			expect(linesB).toEqual([lineB])
			expect(linesA).toEqual([lineA])
		} finally {
			unsubscribeA()
			unsubscribeB()
			expect(readableA.listenerCount("data")).toBe(0)
			expect(readableB.listenerCount("data")).toBe(0)
		}
	})

	test("ignores invalid stdout frames and continues decoding later RPC frames", () => {
		const readable = new PassThrough()
		const writable = new PassThrough()
		const received: RPCMessage[] = []
		const transport = stdioJsonTransport({ readable, writable })
		const unsubscribe = transport.subscribe((message) => received.push(message))
		const message: RPCMessage = { t: "r", id: "1", v: "ok" }

		try {
			expect(() => {
				readable.write("[sample-headless-worker] loading\n")
				readable.write("{not valid json\n")
				readable.write(`${JSON.stringify(message)}\n`)
			}).not.toThrow()

			expect(received).toEqual([message])
		} finally {
			unsubscribe()
			expect(readable.listenerCount("data")).toBe(0)
		}
	})
})
