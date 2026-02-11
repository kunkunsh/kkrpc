import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { WebSocketServer } from "ws"
import { isRPCTimeoutError, RPCChannel, RPCTimeoutError } from "../mod.ts"
import { WebSocketClientIO, WebSocketServerIO } from "../src/adapters/websocket.ts"
import type { IoInterface } from "../src/interface.ts"
import { deserializeError, serializeError } from "../src/serialization.ts"

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("RPCTimeoutError", () => {
	test("constructs with correct properties", () => {
		const err = new RPCTimeoutError("add", 5000)
		expect(err.name).toBe("RPCTimeoutError")
		expect(err.method).toBe("add")
		expect(err.timeoutMs).toBe(5000)
		expect(err.message).toContain("add")
		expect(err.message).toContain("5000ms")
	})

	test("survives serializeError / deserializeError round-trip", () => {
		const original = new RPCTimeoutError("math.divide", 3000)
		const serialized = serializeError(original)
		const deserialized = deserializeError(serialized)

		expect(deserialized.name).toBe("RPCTimeoutError")
		expect(deserialized.message).toBe(original.message)
		expect(isRPCTimeoutError(deserialized)).toBe(true)
		if (isRPCTimeoutError(deserialized)) {
			expect(deserialized.method).toBe("math.divide")
			expect(deserialized.timeoutMs).toBe(3000)
		}
	})

	test("isRPCTimeoutError type guard", () => {
		const err = new RPCTimeoutError("echo", 1000)
		expect(isRPCTimeoutError(err)).toBe(true)
		expect(isRPCTimeoutError(new Error("normal error"))).toBe(false)
		expect(isRPCTimeoutError("string")).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// Integration tests — timeout over WebSocket
// ---------------------------------------------------------------------------

type SlowAPI = {
	fast(): Promise<string>
	slow(ms: number): Promise<string>
	nested: {
		delayed(ms: number): Promise<number>
	}
}

const slowApiMethods: SlowAPI = {
	fast: async () => "ok",
	slow: async (ms) => {
		await new Promise((resolve) => setTimeout(resolve, ms))
		return "done"
	},
	nested: {
		delayed: async (ms) => {
			await new Promise((resolve) => setTimeout(resolve, ms))
			return 42
		}
	}
}

const PORT = 3088
let wss: WebSocketServer

beforeAll(() => {
	wss = new WebSocketServer({ port: PORT })
	wss.on("connection", (ws: WebSocket) => {
		const serverIO = new WebSocketServerIO(ws)
		new RPCChannel<SlowAPI, {}>(serverIO, { expose: slowApiMethods })
	})
})

afterAll(() => {
	wss.close()
})

describe("Integration: Request timeout over RPC", () => {
	test("fast calls complete before timeout", async () => {
		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
		const rpc = new RPCChannel<{}, SlowAPI, IoInterface>(clientIO, {
			timeout: 2000
		})
		const api = rpc.getAPI()

		try {
			expect(await api.fast()).toBe("ok")
		} finally {
			clientIO.destroy()
		}
	})

	test("slow call times out", async () => {
		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
		const rpc = new RPCChannel<{}, SlowAPI, IoInterface>(clientIO, {
			timeout: 50
		})
		const api = rpc.getAPI()

		try {
			await api.slow(500)
			expect.unreachable("should have thrown")
		} catch (error: unknown) {
			expect(isRPCTimeoutError(error)).toBe(true)
			if (isRPCTimeoutError(error)) {
				expect(error.method).toBe("slow")
				expect(error.timeoutMs).toBe(50)
			}
		} finally {
			clientIO.destroy()
		}
	})

	test("nested method times out", async () => {
		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
		const rpc = new RPCChannel<{}, SlowAPI, IoInterface>(clientIO, {
			timeout: 50
		})
		const api = rpc.getAPI()

		try {
			await api.nested.delayed(500)
			expect.unreachable("should have thrown")
		} catch (error: unknown) {
			expect(isRPCTimeoutError(error)).toBe(true)
			if (isRPCTimeoutError(error)) {
				expect(error.method).toBe("nested.delayed")
			}
		} finally {
			clientIO.destroy()
		}
	})

	test("no timeout (default) — slow calls succeed", async () => {
		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
		const rpc = new RPCChannel<{}, SlowAPI, IoInterface>(clientIO)
		const api = rpc.getAPI()

		try {
			// No timeout configured, so even a 200ms call should work
			expect(await api.slow(200)).toBe("done")
		} finally {
			clientIO.destroy()
		}
	})

	test("destroy rejects pending requests", async () => {
		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
		const rpc = new RPCChannel<{}, SlowAPI, IoInterface>(clientIO, {
			timeout: 5000
		})
		const api = rpc.getAPI()

		const promise = api.slow(2000)
		// Small delay to ensure the call is in-flight
		await new Promise((resolve) => setTimeout(resolve, 20))
		rpc.destroy()

		try {
			await promise
			expect.unreachable("should have thrown")
		} catch (error: unknown) {
			expect(error instanceof Error).toBe(true)
			if (error instanceof Error) {
				expect(error.message).toContain("destroyed")
			}
		}
	})
})
