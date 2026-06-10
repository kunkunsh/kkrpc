import { describe, expect, test } from "bun:test"

import { dispose, RPCChannel, wrap } from "../src/entries/mod.ts"
import type { RPCMessage, RPCMessageMetadata, RPCPlugin, Transport } from "../src/entries/mod.ts"
import { middlewarePlugin, type MiddlewareHandler } from "../src/entries/middleware.ts"

interface ServerAPI {
	echo(message: string): Promise<string>
}

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true }
	peer?: MemoryTransport
	private listeners = new Set<(message: RPCMessage) => void>()

	send(message: RPCMessage): void {
		queueMicrotask(() => {
			for (const listener of this.peer?.listeners ?? []) listener(message)
		})
	}

	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}
}

function createPair(): [MemoryTransport, MemoryTransport] {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return [a, b]
}

function pendingRequestCount(channel: object): number {
	const pending = Reflect.get(channel, "pending")
	if (!(pending instanceof Map)) throw new Error("RPCChannel pending state is unavailable")
	return pending.size
}

const api: ServerAPI = {
	async echo(message) {
		return message
	}
}

describe("stable RPC metadata", () => {
	test("outgoing metadata provider reaches receive-side plugins", async () => {
		let seenMeta: RPCMessageMetadata | undefined
		const [clientTransport, serverTransport] = createPair()
		const plugin: RPCPlugin = {
			onRequest(ctx) {
				seenMeta = ctx.meta
			}
		}
		const server = new RPCChannel<ServerAPI, object>(serverTransport, { expose: api, plugins: [plugin] })
		const client = new RPCChannel<object, ServerAPI>(clientTransport, {
			getMetadata: () => ({
				traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
				requestId: "request-1",
				runtime: { worker: "client", retry: 0, sampled: true }
			})
		})

		try {
			expect(await client.getAPI().echo("hello")).toBe("hello")
			expect(seenMeta).toEqual({
				traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
				requestId: "request-1",
				runtime: { worker: "client", retry: 0, sampled: true }
			})
		} finally {
			client.destroy()
			server.destroy()
		}
	})

	test("outgoing metadata provider reaches middleware context", async () => {
		let seenMeta: RPCMessageMetadata | undefined
		const [clientTransport, serverTransport] = createPair()
		const middleware: MiddlewareHandler = async (ctx, next) => {
			seenMeta = ctx.meta
			return await next()
		}
		const server = new RPCChannel<ServerAPI, object>(serverTransport, {
			expose: api,
			plugins: [middlewarePlugin([middleware])]
		})
		const remote = wrap<ServerAPI>(clientTransport, {
			getMetadata: () => ({ baggage: "tenant=acme", sessionId: "session-1" })
		})

		try {
			expect(await remote.echo("hello")).toBe("hello")
			expect(seenMeta).toEqual({ baggage: "tenant=acme", sessionId: "session-1" })
		} finally {
			dispose(remote)
			server.destroy()
		}
	})

	test("throwing metadata provider rejects without sending request", async () => {
		let handlerCalled = false
		const [clientTransport, serverTransport] = createPair()
		const server = new RPCChannel<ServerAPI, object>(serverTransport, {
			expose: {
				async echo(message) {
					handlerCalled = true
					return message
				}
			}
		})
		const client = new RPCChannel<object, ServerAPI>(clientTransport, {
			getMetadata: () => {
				throw new Error("metadata unavailable")
			}
		})

		try {
			await expect(client.getAPI().echo("hello")).rejects.toThrow("metadata unavailable")
			expect(handlerCalled).toBe(false)
			expect(pendingRequestCount(client)).toBe(0)
		} finally {
			client.destroy()
			server.destroy()
		}
	})
})
