import { describe, expect, test } from "bun:test"
import { z } from "zod"

import type { RPCMessage, Transport } from "../next.ts"
import {
	classicPlugins,
	createCompatChannel,
	exposeCompat,
	wrapCompat
} from "../next-classic-compat.ts"

interface API {
	add(a: number, b: number): Promise<number>
}

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true }
	peer?: MemoryTransport
	private listener?: (message: RPCMessage) => void
	send(message: RPCMessage): void {
		queueMicrotask(() => this.peer?.listener?.(message))
	}
	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listener = listener
		return () => {
			this.listener = undefined
		}
	}
}

function createPair() {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return { a, b }
}

describe("kkrpc/next classic compatibility facade", () => {
	test("classicPlugins translates validators and interceptors", async () => {
		const { a, b } = createPair()
		const plugins = classicPlugins<API>({
			validators: { add: { input: z.tuple([z.number(), z.number()]), output: z.number() } },
			interceptors: [async (ctx, next) => Number(await next()) * 2]
		})
		const server = createCompatChannel<{ add(a: number, b: number): Promise<number> }, object>(b, {
			expose: { add: async (a, b) => a + b },
			plugins
		})
		const client = createCompatChannel<object, API>(a)

		try {
			expect(await client.getAPI().add(1, 2)).toBe(6)
			await expect(client.getAPI().add("x" as unknown as number, 2)).rejects.toThrow(
				"input validation failed"
			)
		} finally {
			client.destroy()
			server.destroy()
		}
	})

	test("wrapCompat and exposeCompat accept migration-style options", async () => {
		const { a, b } = createPair()
		const controller = exposeCompat({ add: async (a: number, b: number) => a + b }, b, {
			validators: { add: { input: z.tuple([z.number(), z.number()]), output: z.number() } },
			interceptors: [async (_ctx, next) => Number(await next()) + 1]
		})
		const api = wrapCompat<API>(a)

		try {
			expect(await api.add(2, 3)).toBe(6)
		} finally {
			controller.dispose()
		}
	})
})
