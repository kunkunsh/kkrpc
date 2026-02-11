/**
 * Streaming + Middleware demo — Bun native WebSocket server.
 *
 * Demonstrates four interceptor patterns:
 *   1. Logging    — logs every RPC call with method name and args
 *   2. Timing     — measures and logs execution time per call
 *   3. Auth       — blocks protected methods unless the session is authenticated
 *   4. Rate limit — limits calls per second, rejects excess with an error
 *
 * Run with: bun run server-bun.ts
 * Then in another terminal: bun run client.ts
 */
import { RPCChannel, WebSocketServerIO, type RPCInterceptor, type WebSocketLike } from "kkrpc"
import { createApi, type StreamingMiddlewareAPI } from "./api.ts"

const PORT = 3100

// Map to track Bun ServerWebSocket -> our wrapper
const connections = new Map<any, WebSocketLike>()

// ─── Interceptor factories ───────────────────────────────────────────────────

const logger: RPCInterceptor = async (ctx, next) => {
	const argsStr = ctx.args
		.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
		.join(", ")
	console.log(`  [log]  ${ctx.method}(${argsStr})`)
	return next()
}

const timing: RPCInterceptor = async (ctx, next) => {
	const start = performance.now()
	const result = await next()
	const elapsed = (performance.now() - start).toFixed(1)
	console.log(`  [time] ${ctx.method} → ${elapsed}ms`)
	return result
}

function createAuthInterceptor(session: {
	authenticated: boolean
	username: string
}): RPCInterceptor {
	const protectedMethods = new Set(["getSecretData"])
	return async (ctx, next) => {
		if (protectedMethods.has(ctx.method) && !session.authenticated) {
			throw new Error(`Unauthorized: '${ctx.method}' requires authentication. Call login() first.`)
		}
		return next()
	}
}

function createRateLimiter(max: number, windowMs: number = 1000): RPCInterceptor {
	const calls: number[] = []
	return async (ctx, next) => {
		const now = Date.now()
		while (calls.length > 0 && calls[0]! <= now - windowMs) {
			calls.shift()
		}
		if (calls.length >= max) {
			throw new Error(`Rate limit exceeded: max ${max} calls per ${windowMs}ms. Try again shortly.`)
		}
		calls.push(now)
		return next()
	}
}

// ─── Bun WebSocket wrapper ───────────────────────────────────────────────────

/**
 * Creates a WebSocketLike wrapper around Bun's ServerWebSocket.
 * Bun uses a different pattern (callback-based) vs DOM WebSocket (event setters).
 * This wrapper bridges the two patterns.
 */
function createBunWebSocketLike(bunWs: any): WebSocketLike {
	return {
		onmessage: null,
		onerror: null,
		send(data: string) {
			bunWs.send(data)
		},
		close() {
			bunWs.close()
		}
	}
}

// ─── Bun server setup ────────────────────────────────────────────────────────

console.log(`[server] Streaming + Middleware demo (Bun native) listening on ws://localhost:${PORT}`)
console.log(`[server] Interceptors: logger → timing → auth → rateLimiter`)

Bun.serve({
	port: PORT,
	fetch(req, server) {
		// Upgrade HTTP request to WebSocket
		if (server.upgrade(req)) {
			return // Upgraded successfully
		}
		return new Response("WebSocket upgrade failed", { status: 400 })
	},
	websocket: {
		open(bunWs) {
			console.log("[server] Client connected")

			// Create wrapper that implements WebSocketLike
			const wrapper = createBunWebSocketLike(bunWs)
			connections.set(bunWs, wrapper)

			// Each connection gets its own session and interceptors
			const session = { authenticated: false, username: "" }
			const api = createApi(session)
			const auth = createAuthInterceptor(session)
			const rateLimiter = createRateLimiter(5)

			new RPCChannel<StreamingMiddlewareAPI, {}>(new WebSocketServerIO(wrapper), {
				expose: api,
				interceptors: [logger, timing, auth, rateLimiter]
			})
		},
		message(bunWs, message) {
			// Route Bun message to our wrapper's onmessage handler
			const wrapper = connections.get(bunWs)
			if (wrapper?.onmessage) {
				wrapper.onmessage({ data: message })
			}
		},
		close(bunWs, code, reason) {
			const wrapper = connections.get(bunWs)
			if (wrapper) {
				// Trigger any cleanup
				wrapper.onmessage = null
				wrapper.onerror = null
				connections.delete(bunWs)
			}
			console.log(`[server] Client disconnected`)
		}
	}
})
