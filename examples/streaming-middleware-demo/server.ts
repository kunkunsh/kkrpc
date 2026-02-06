/**
 * Streaming + Middleware demo — WebSocket server.
 *
 * Demonstrates four interceptor patterns:
 *   1. Logging    — logs every RPC call with method name and args
 *   2. Timing     — measures and logs execution time per call
 *   3. Auth       — blocks protected methods unless the session is authenticated
 *   4. Rate limit — limits calls per second, rejects excess with an error
 *
 * Run with: bun run server.ts
 * Then in another terminal: bun run client.ts
 */
import { WebSocketServer } from "ws"
import { RPCChannel, WebSocketServerIO, type RPCInterceptor } from "kkrpc"
import { createApi, type StreamingMiddlewareAPI } from "./api.ts"

const PORT = 3100

// ─── Interceptor factories ───────────────────────────────────────────────────

/**
 * Logging interceptor — logs method name and stringified args.
 */
const logger: RPCInterceptor = async (ctx, next) => {
	const argsStr = ctx.args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(", ")
	console.log(`  [log]  ${ctx.method}(${argsStr})`)
	return next()
}

/**
 * Timing interceptor — measures wall-clock time for handler execution.
 * Wraps `next()` so it captures time spent in all downstream interceptors + the handler.
 */
const timing: RPCInterceptor = async (ctx, next) => {
	const start = performance.now()
	const result = await next()
	const elapsed = (performance.now() - start).toFixed(1)
	console.log(`  [time] ${ctx.method} → ${elapsed}ms`)
	return result
}

/**
 * Auth interceptor factory — uses closure over the per-connection session.
 *
 * Protected methods (listed in `protectedMethods`) are rejected with
 * "Unauthorized" unless `session.authenticated` is true. Public methods
 * (including `login`) pass through unconditionally.
 */
function createAuthInterceptor(session: { authenticated: boolean; username: string }): RPCInterceptor {
	const protectedMethods = new Set(["getSecretData"])

	return async (ctx, next) => {
		if (protectedMethods.has(ctx.method) && !session.authenticated) {
			throw new Error(`Unauthorized: '${ctx.method}' requires authentication. Call login() first.`)
		}
		return next()
	}
}

/**
 * Rate-limiting interceptor factory — sliding window counter.
 *
 * Tracks call timestamps in a window. If the number of calls within the
 * window exceeds `max`, the call is rejected immediately with an error.
 */
function createRateLimiter(max: number, windowMs: number = 1000): RPCInterceptor {
	const calls: number[] = []

	return async (ctx, next) => {
		const now = Date.now()
		// Evict timestamps outside the window
		while (calls.length > 0 && calls[0] <= now - windowMs) {
			calls.shift()
		}
		if (calls.length >= max) {
			throw new Error(`Rate limit exceeded: max ${max} calls per ${windowMs}ms. Try again shortly.`)
		}
		calls.push(now)
		return next()
	}
}

// ─── Server setup ────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT })

wss.on("connection", (ws) => {
	console.log("[server] Client connected")

	// Each connection gets its own session state and API instance
	const session = { authenticated: false, username: "" }
	const api = createApi(session)
	const auth = createAuthInterceptor(session)
	const rateLimiter = createRateLimiter(5) // 5 calls per second

	const io = new WebSocketServerIO(ws)
	new RPCChannel<StreamingMiddlewareAPI, {}>(io, {
		expose: api,
		// Onion order: logger → timing → auth → rateLimiter → handler
		// Logger is outermost so it logs everything including rejected calls.
		// Timing wraps auth + handler so it measures total including auth check.
		// Auth runs before rate limiter so unauthorized calls don't consume quota.
		interceptors: [logger, timing, auth, rateLimiter]
	})

	ws.on("close", () => {
		console.log(`[server] Client disconnected (was: ${session.username || "anonymous"})`)
	})
})

console.log(`[server] Streaming + Middleware demo listening on ws://localhost:${PORT}`)
console.log(`[server] Interceptors: logger → timing → auth → rateLimiter`)
