import { describe, expect, test } from "bun:test"

import { createTransport, type Platform } from "../src/entries/transport.ts"
import { superJsonCodec, superJsonLineCodec, superjsonCodec, superjsonLineCodec } from "../src/entries/superjson.ts"

class StringPlatform implements Platform<string> {
	capabilities = { objectMode: false, transfer: false }
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

class TransferCapableStringPlatform implements Platform<string> {
	capabilities = { objectMode: false, transfer: true }
	wires: string[] = []
	sentTransfers: Transferable[][] = []
	listener?: (wire: string) => void
	send(wire: string, transfers: Transferable[] = []): void {
		this.wires.push(wire)
		this.sentTransfers.push(transfers)
	}
	subscribe(listener: (wire: string) => void): () => void {
		this.listener = listener
		return () => {
			this.listener = undefined
		}
	}
}

describe("kkrpc SuperJSON codecs", () => {
	test("preserves original public export names", () => {
		expect(typeof superJsonCodec).toBe("function")
		expect(typeof superJsonLineCodec).toBe("function")
	})

	test("superjsonCodec round-trips non-JSON values", () => {
		const codec = superJsonCodec<unknown>()
		const input = {
			date: new Date("2026-06-07T00:00:00.000Z"),
			map: new Map([["a", 1]]),
			set: new Set(["x", "y"]),
			bigint: 123n
		}
		const output = codec.decode(codec.encode(input)) as typeof input

		expect(output.date).toBeInstanceOf(Date)
		expect(output.date.toISOString()).toBe("2026-06-07T00:00:00.000Z")
		expect(output.map).toBeInstanceOf(Map)
		expect(output.map.get("a")).toBe(1)
		expect(output.set).toBeInstanceOf(Set)
		expect(output.set.has("x")).toBe(true)
		expect(output.bigint).toBe(123n)
		expect(codec.capabilities?.transfer).toBe(false)
	})

	test("superjsonLineCodec adds newline framing", () => {
		const codec = superJsonLineCodec<{ value: Date }>()
		const wire = codec.encode({ value: new Date("2026-06-07T00:00:00.000Z") })
		const decoded = codec.decode(wire)

		expect(wire.endsWith("\n")).toBe(true)
		expect(decoded.value).toBeInstanceOf(Date)
	})

	test("composes with createTransport", () => {
		const platform = new StringPlatform()
		const transport = createTransport({ platform, codec: superJsonCodec<{ value: bigint }>() })
		const received: Array<{ value: bigint }> = []

		const unsubscribe = transport.subscribe((message) => {
			received.push(message)
		})
		transport.send({ value: 5n }, [new ArrayBuffer(1)])
		expect(platform.wires).toHaveLength(1)
		expect(transport.capabilities?.transfer).toBe(false)
		platform.listener?.(platform.wires[0])
		expect(received).toEqual([{ value: 5n }])
		unsubscribe()
		expect(platform.listener).toBeUndefined()
	})

	test("does not forward transfers through SuperJSON codecs", () => {
		const platform = new TransferCapableStringPlatform()
		const transport = createTransport({ platform, codec: superJsonCodec<{ value: bigint }>() })

		transport.send({ value: 5n }, [new ArrayBuffer(1)])

		expect(transport.capabilities?.transfer).toBe(false)
		expect(platform.sentTransfers).toEqual([[]])
	})

	test("lowercase aliases remain available", () => {
		expect(superjsonCodec).toBe(superJsonCodec)
		expect(superjsonLineCodec).toBe(superJsonLineCodec)
	})
})
