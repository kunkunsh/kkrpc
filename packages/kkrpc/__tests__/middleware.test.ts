import { describe, expect, test } from "bun:test"

import { expose, wrap } from "../mod.ts"
import type { RPCMessage, Transport } from "../mod.ts"
import { middlewarePlugin, type RPCInterceptor } from "../middleware.ts"

interface API {
	add(a: number, b: number): Promise<number>
	secret(): Promise<string>
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

const apiImpl: API = {
	add: async (a, b) => a + b,
	secret: async () => "secret"
}

describe("kkrpc middleware plugin", () => {
	test("runs interceptors in onion order", async () => {
		const events: string[] = []
		const interceptors: RPCInterceptor[] = [
			async (ctx, next) => {
				events.push(`outer before ${ctx.method}`)
				const value = await next()
				events.push("outer after")
				return value
			},
			async (_ctx, next) => {
				events.push("inner before")
				const value = await next()
				events.push("inner after")
				return value
			}
		]
		const { a, b } = createPair()
		const controller = expose(apiImpl, b, { plugins: [middlewarePlugin(interceptors)] })
		const api = wrap<API>(a)

		try {
			expect(await api.add(1, 2)).toBe(3)
			expect(events).toEqual([
				"outer before add",
				"inner before",
				"inner after",
				"outer after"
			])
		} finally {
			controller.dispose()
		}
	})

	test("interceptors can mutate args and transform results", async () => {
		const { a, b } = createPair()
		const controller = expose(apiImpl, b, {
			plugins: [
				middlewarePlugin([
					async (ctx, next) => {
						ctx.args = [5, 6]
						return Number(await next()) * 10
					}
				])
			]
		})
		const api = wrap<API>(a)

		try {
			expect(await api.add(1, 2)).toBe(110)
		} finally {
			controller.dispose()
		}
	})

	test("interceptors can block a call", async () => {
		const { a, b } = createPair()
		const controller = expose(apiImpl, b, {
			plugins: [
				middlewarePlugin([
					async (ctx, next) => {
						if (ctx.method === "secret") throw new Error("blocked")
						return await next()
					}
				])
			]
		})
		const api = wrap<API>(a)

		try {
			await expect(api.secret()).rejects.toThrow("blocked")
		} finally {
			controller.dispose()
		}
	})

	test("interceptors share state", async () => {
		const { a, b } = createPair()
		const controller = expose(apiImpl, b, {
			plugins: [
				middlewarePlugin([
					async (ctx, next) => {
						ctx.state.multiplier = 4
						return await next()
					},
					async (ctx, next) => Number(await next()) * Number(ctx.state.multiplier)
				])
			]
		})
		const api = wrap<API>(a)

		try {
			expect(await api.add(2, 3)).toBe(20)
		} finally {
			controller.dispose()
		}
	})

	test("interceptors reject double next calls", async () => {
		const { a, b } = createPair()
		const controller = expose(apiImpl, b, {
			plugins: [
				middlewarePlugin([
					async (_ctx, next) => {
						await next()
						return await next()
					}
				])
			]
		})
		const api = wrap<API>(a)

		try {
			await expect(api.add(1, 2)).rejects.toThrow("RPC interceptor next() called multiple times")
		} finally {
			controller.dispose()
		}
	})
})
