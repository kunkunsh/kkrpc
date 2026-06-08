import { describe, expect, test } from "bun:test"

import { expose, RPCChannel, wrap } from "../next.ts"
import type { RPCMessage, RPCPlugin, Transport } from "../next.ts"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
	fail(): Promise<void>
}

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true }
	peer?: MemoryTransport
	private listener?: (message: RPCMessage) => void

	send(message: RPCMessage, transfers: Transferable[] = []): void {
		void transfers
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

function createApi() {
	return {
		add: async (a: number, b: number) => a + b,
		fail: async () => {
			throw new Error("original failure")
		}
	}
}

describe("kkrpc/next plugins", () => {
	test("runs receiving-side hooks in onion order", async () => {
		const events: string[] = []
		const { a, b } = createPair()
		const plugins: RPCPlugin[] = [
			{
				name: "outer",
				onRequest: (ctx) => {
					events.push(`outer request ${ctx.method}`)
				},
				wrapHandler: async (_ctx, next) => {
					events.push("outer before")
					const value = await next()
					events.push("outer after")
					return value
				},
				onResponse: (ctx) => {
					events.push(`outer response ${ctx.result}`)
				}
			},
			{
				name: "inner",
				onRequest: (ctx) => {
					events.push(`inner request ${ctx.method}`)
				},
				wrapHandler: async (_ctx, next) => {
					events.push("inner before")
					const value = await next()
					events.push("inner after")
					return value
				},
				onResponse: (ctx) => {
					events.push(`inner response ${ctx.result}`)
				}
			}
		]
		const controller = expose(createApi(), b, { plugins })
		const api = wrap<RemoteAPI>(a)

		try {
			expect(await api.add(1, 2)).toBe(3)
			expect(events).toEqual([
				"outer request add",
				"inner request add",
				"outer before",
				"inner before",
				"inner after",
				"outer after",
				"outer response 3",
				"inner response 3"
			])
		} finally {
			controller.dispose()
		}
	})

	test("plugins can mutate args and results", async () => {
		const { a, b } = createPair()
		const controller = expose(createApi(), b, {
			plugins: [
				{
					onRequest(ctx) {
						ctx.args = [10, 20]
					},
					onResponse(ctx) {
						ctx.result = Number(ctx.result) * 2
					}
				}
			]
		})
		const api = wrap<RemoteAPI>(a)

		try {
			expect(await api.add(1, 2)).toBe(60)
		} finally {
			controller.dispose()
		}
	})

	test("plugins can replace errors before the response is sent", async () => {
		const { a, b } = createPair()
		const controller = expose(createApi(), b, {
			plugins: [
				{
					onError(ctx) {
						ctx.error = new Error(`wrapped ${ctx.method}`)
					}
				}
			]
		})
		const api = wrap<RemoteAPI>(a)

		try {
			await expect(api.fail()).rejects.toThrow("wrapped fail")
		} finally {
			controller.dispose()
		}
	})

	test("no-plugin channels preserve existing core behavior", async () => {
		const { a, b } = createPair()
		const server = new RPCChannel<ReturnType<typeof createApi>, object>(b, { expose: createApi() })
		const client = new RPCChannel<object, RemoteAPI>(a)

		try {
			expect(await client.getAPI().add(2, 5)).toBe(7)
		} finally {
			client.destroy()
			server.destroy()
		}
	})
})
