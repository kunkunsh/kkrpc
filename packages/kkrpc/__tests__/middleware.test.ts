import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { WebSocketServer } from "ws"
import { WebSocketClientIO, WebSocketServerIO } from "../src/adapters/websocket.ts"
import { RPCChannel } from "../src/channel.ts"
import type { IoInterface } from "../src/interface.ts"
import { runInterceptors, type RPCCallContext, type RPCInterceptor } from "../src/middleware.ts"

// ---------------------------------------------------------------------------
// Unit tests: runInterceptors
// ---------------------------------------------------------------------------

describe("runInterceptors", () => {
	test("calls handler directly with 0 interceptors", async () => {
		const ctx: RPCCallContext = { method: "add", args: [1, 2], state: {} }
		const result = await runInterceptors([], ctx, async () => 42)
		expect(result).toBe(42)
	})

	test("single interceptor wraps handler", async () => {
		const log: string[] = []
		const interceptor: RPCInterceptor = async (ctx, next) => {
			log.push("before")
			const result = await next()
			log.push("after")
			return result
		}

		const ctx: RPCCallContext = { method: "echo", args: ["hi"], state: {} }
		const result = await runInterceptors([interceptor], ctx, async () => "hello")
		expect(result).toBe("hello")
		expect(log).toEqual(["before", "after"])
	})

	test("multiple interceptors execute in onion order", async () => {
		const log: string[] = []
		const a: RPCInterceptor = async (_ctx, next) => {
			log.push("a-before")
			const result = await next()
			log.push("a-after")
			return result
		}
		const b: RPCInterceptor = async (_ctx, next) => {
			log.push("b-before")
			const result = await next()
			log.push("b-after")
			return result
		}

		const ctx: RPCCallContext = { method: "test", args: [], state: {} }
		await runInterceptors([a, b], ctx, async () => "ok")
		expect(log).toEqual(["a-before", "b-before", "b-after", "a-after"])
	})

	test("interceptor can modify return value", async () => {
		const doubler: RPCInterceptor = async (_ctx, next) => {
			const result = (await next()) as number
			return result * 2
		}

		const ctx: RPCCallContext = { method: "get", args: [], state: {} }
		const result = await runInterceptors([doubler], ctx, async () => 21)
		expect(result).toBe(42)
	})

	test("interceptor can throw to abort", async () => {
		const guard: RPCInterceptor = async (ctx, _next) => {
			throw new Error(`Unauthorized: ${ctx.method}`)
		}

		const ctx: RPCCallContext = { method: "admin.delete", args: [], state: {} }
		expect(runInterceptors([guard], ctx, async () => "should not reach")).rejects.toThrow(
			"Unauthorized: admin.delete"
		)
	})

	test("ctx.state is shared between interceptors", async () => {
		const setUser: RPCInterceptor = async (ctx, next) => {
			ctx.state.userId = "user-123"
			return next()
		}
		const checkUser: RPCInterceptor = async (ctx, next) => {
			if (!ctx.state.userId) throw new Error("no user")
			return next()
		}

		const ctx: RPCCallContext = { method: "test", args: [], state: {} }
		const result = await runInterceptors([setUser, checkUser], ctx, async () => "ok")
		expect(result).toBe("ok")
		expect(ctx.state.userId).toBe("user-123")
	})

	test("ctx.method and ctx.args are correct", async () => {
		let captured: RPCCallContext | undefined
		const spy: RPCInterceptor = async (ctx, next) => {
			captured = ctx
			return next()
		}

		const ctx: RPCCallContext = {
			method: "math.add",
			args: [10, 20],
			state: {}
		}
		await runInterceptors([spy], ctx, async () => 30)
		expect(captured!.method).toBe("math.add")
		expect(captured!.args).toEqual([10, 20])
	})
})

// ---------------------------------------------------------------------------
// Integration tests — interceptors over WebSocket RPC
// ---------------------------------------------------------------------------

type TestAPI = {
	echo(message: string): Promise<string>
	add(a: number, b: number): Promise<number>
	admin: {
		secret(): Promise<string>
	}
}

const testApiMethods: TestAPI = {
	echo: async (message) => message,
	add: async (a, b) => a + b,
	admin: {
		secret: async () => "top-secret-data"
	}
}

describe("Integration: Interceptors over RPC", () => {
	test("logging interceptor sees correct method and args", async () => {
		const logged: { method: string; args: unknown[] }[] = []
		const logger: RPCInterceptor = async (ctx, next) => {
			logged.push({ method: ctx.method, args: [...ctx.args] })
			return next()
		}

		const PORT = 3080
		const wss = new WebSocketServer({ port: PORT })
		wss.on("connection", (ws: WebSocket) => {
			const serverIO = new WebSocketServerIO(ws)
			new RPCChannel<TestAPI, {}>(serverIO, {
				expose: testApiMethods,
				interceptors: [logger]
			})
		})

		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
		const rpc = new RPCChannel<{}, TestAPI, IoInterface>(clientIO)
		const api = rpc.getAPI()

		try {
			await api.echo("hello")
			await api.add(3, 4)

			expect(logged).toHaveLength(2)
			expect(logged[0].method).toBe("echo")
			expect(logged[0].args).toEqual(["hello"])
			expect(logged[1].method).toBe("add")
			expect(logged[1].args).toEqual([3, 4])
		} finally {
			clientIO.destroy()
			wss.close()
		}
	})

	test("auth interceptor rejects unauthorized calls", async () => {
		const authInterceptor: RPCInterceptor = async (ctx, next) => {
			if (ctx.method.startsWith("admin.")) {
				throw new Error("Unauthorized")
			}
			return next()
		}

		const PORT = 3081
		const wss = new WebSocketServer({ port: PORT })
		wss.on("connection", (ws: WebSocket) => {
			const serverIO = new WebSocketServerIO(ws)
			new RPCChannel<TestAPI, {}>(serverIO, {
				expose: testApiMethods,
				interceptors: [authInterceptor]
			})
		})

		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
		const rpc = new RPCChannel<{}, TestAPI, IoInterface>(clientIO)
		const api = rpc.getAPI()

		try {
			// Non-admin calls should work
			expect(await api.echo("hi")).toBe("hi")

			// Admin calls should be rejected
			try {
				await api.admin.secret()
				expect.unreachable("should have thrown")
			} catch (error: unknown) {
				expect(error instanceof Error).toBe(true)
				if (error instanceof Error) {
					expect(error.message).toContain("Unauthorized")
				}
			}
		} finally {
			clientIO.destroy()
			wss.close()
		}
	})

	test("multiple interceptors execute in onion order", async () => {
		const log: string[] = []

		const first: RPCInterceptor = async (_ctx, next) => {
			log.push("1-in")
			const result = await next()
			log.push("1-out")
			return result
		}
		const second: RPCInterceptor = async (_ctx, next) => {
			log.push("2-in")
			const result = await next()
			log.push("2-out")
			return result
		}

		const PORT = 3082
		const wss = new WebSocketServer({ port: PORT })
		wss.on("connection", (ws: WebSocket) => {
			const serverIO = new WebSocketServerIO(ws)
			new RPCChannel<TestAPI, {}>(serverIO, {
				expose: testApiMethods,
				interceptors: [first, second]
			})
		})

		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
		const rpc = new RPCChannel<{}, TestAPI, IoInterface>(clientIO)
		const api = rpc.getAPI()

		try {
			await api.add(1, 2)
			expect(log).toEqual(["1-in", "2-in", "2-out", "1-out"])
		} finally {
			clientIO.destroy()
			wss.close()
		}
	})

	test("interceptor can transform return value", async () => {
		const doubler: RPCInterceptor = async (_ctx, next) => {
			const result = (await next()) as number
			return result * 2
		}

		const PORT = 3083
		const wss = new WebSocketServer({ port: PORT })
		wss.on("connection", (ws: WebSocket) => {
			const serverIO = new WebSocketServerIO(ws)
			new RPCChannel<TestAPI, {}>(serverIO, {
				expose: testApiMethods,
				interceptors: [doubler]
			})
		})

		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
		const rpc = new RPCChannel<{}, TestAPI, IoInterface>(clientIO)
		const api = rpc.getAPI()

		try {
			const result = await api.add(3, 4)
			expect(result).toBe(14) // (3+4) * 2
		} finally {
			clientIO.destroy()
			wss.close()
		}
	})

	test("no interceptors = backward-compatible behavior", async () => {
		const PORT = 3084
		const wss = new WebSocketServer({ port: PORT })
		wss.on("connection", (ws: WebSocket) => {
			const serverIO = new WebSocketServerIO(ws)
			new RPCChannel<TestAPI, {}>(serverIO, { expose: testApiMethods })
		})

		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
		const rpc = new RPCChannel<{}, TestAPI, IoInterface>(clientIO)
		const api = rpc.getAPI()

		try {
			expect(await api.echo("hello")).toBe("hello")
			expect(await api.add(10, 20)).toBe(30)
		} finally {
			clientIO.destroy()
			wss.close()
		}
	})
})
