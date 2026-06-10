/**
 * RPC metadata propagation tests.
 * These verify callers can attach out-of-band metadata that receiving
 * interceptors observe without coupling kkrpc to any application-specific type.
 */
import { describe, expect, test } from "bun:test"
import { RPCChannel } from "../src/channel.ts"
import type { IoInterface, IoMessage } from "../src/interface.ts"
import type { RPCInterceptor } from "../src/middleware.ts"
import type { RPCMessageMetadata } from "../src/serialization-types.ts"

class MemoryIO implements IoInterface {
	private peer?: MemoryIO
	private messageQueue: Array<string | IoMessage | null> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null

	constructor(public readonly name: string) {}

	connect(peer: MemoryIO): void {
		this.peer = peer
	}

	on(_event: "message", _listener: (message: string | IoMessage) => void): void
	on(_event: "error", _listener: (error: Error) => void): void
	on(_event: "message" | "error", _listener: Function): void {}

	off(_event: "message" | "error", _listener: Function): void {}

	read(): Promise<string | IoMessage | null> {
		if (this.messageQueue.length > 0) {
			return Promise.resolve(this.messageQueue.shift() ?? null)
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	write(message: string | IoMessage): Promise<void> {
		this.peer?.receive(message)
		return Promise.resolve()
	}

	destroy(): void {
		this.receive(null)
	}

	receive(message: string | IoMessage | null): void {
		if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
			return
		}

		this.messageQueue.push(message)
	}
}

function createMemoryPair(): [MemoryIO, MemoryIO] {
	const left = new MemoryIO("metadata-left")
	const right = new MemoryIO("metadata-right")
	left.connect(right)
	right.connect(left)
	return [left, right]
}

function pendingRequestCount(channel: object): number {
	const pendingRequests = Reflect.get(channel, "pendingRequests")
	if (!pendingRequests || typeof pendingRequests !== "object") {
		throw new Error("RPCChannel pendingRequests state is unavailable")
	}
	return Object.keys(pendingRequests).length
}

interface ServerAPI {
	echo(message: string): Promise<string>
}

describe("RPC metadata", () => {
	test("outgoing metadata provider reaches the receiving interceptor", async () => {
		let seenMeta: RPCMessageMetadata | undefined
		const [clientIO, serverIO] = createMemoryPair()
		const interceptor: RPCInterceptor = async (ctx, next) => {
			seenMeta = ctx.meta
			return next()
		}
		const serverApi: ServerAPI = {
			echo: async (message) => message
		}

		new RPCChannel<ServerAPI, {}>(serverIO, {
			expose: serverApi,
			interceptors: [interceptor]
		})
		const clientRpc = new RPCChannel<{}, ServerAPI>(clientIO, {
			getMetadata: () => ({
				activity: { activityId: "activity-1", operationId: "operation-1" }
			})
		})

		try {
			expect(await clientRpc.getAPI().echo("hello")).toBe("hello")
			expect(seenMeta).toEqual({
				activity: { activityId: "activity-1", operationId: "operation-1" }
			})
		} finally {
			clientIO.destroy()
			serverIO.destroy()
		}
	})

	test("throwing metadata provider rejects without retaining a pending request", async () => {
		let handlerCalled = false
		const [clientIO, serverIO] = createMemoryPair()
		const serverApi: ServerAPI = {
			echo: async (message) => {
				handlerCalled = true
				return message
			}
		}

		new RPCChannel<ServerAPI, {}>(serverIO, { expose: serverApi })
		const clientRpc = new RPCChannel<{}, ServerAPI>(clientIO, {
			getMetadata: () => {
				throw new Error("metadata unavailable")
			}
		})

		try {
			await expect(clientRpc.getAPI().echo("hello")).rejects.toThrow("metadata unavailable")
			expect(handlerCalled).toBe(false)
			expect(pendingRequestCount(clientRpc)).toBe(0)
		} finally {
			clientIO.destroy()
			serverIO.destroy()
		}
	})
})
