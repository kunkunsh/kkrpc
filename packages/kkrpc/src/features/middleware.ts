/**
 * Interceptor-style middleware plugin for stable kkrpc.
 *
 * Middleware is implemented as a plugin wrapper around local handler execution.
 * Interceptors run in onion order, can inspect or replace arguments, can block a
 * call by not invoking `next()`, and share per-request data through `ctx.state`.
 * This file is optional and separate from `kkrpc` so core users do not pay
 * for middleware helpers unless they import `kkrpc/middleware`.
 *
 * @example
 * ```ts
 * import { expose } from "kkrpc"
 * import { middlewarePlugin } from "kkrpc/middleware"
 *
 * const auth = middlewarePlugin([
 * 	async (ctx, next) => {
 * 		if (ctx.method === "admin.deleteUser") throw new Error("forbidden")
 * 		return await next()
 * 	}
 * ])
 *
 * expose(api, transport, { plugins: [auth] })
 * ```
 */

import type { RPCPlugin } from "../core/plugins.ts"

/** Context passed through each middleware interceptor for a single RPC call. */
export interface RPCCallContext {
	id: string
	method: string
	args: unknown[]
	state: Record<string, unknown>
}

/** A receive-side onion middleware function. */
export type RPCInterceptor = (ctx: RPCCallContext, next: () => Promise<unknown>) => Promise<unknown>

/**
 * Run interceptors in onion order around a final handler.
 *
 * Throws if an interceptor calls the same `next()` more than once. This mirrors
 * common middleware frameworks and prevents duplicated RPC handler execution.
 */
export function runInterceptors(
	interceptors: readonly RPCInterceptor[],
	ctx: RPCCallContext,
	handler: () => Promise<unknown>
): Promise<unknown> {
	let index = -1
	const dispatch = (nextIndex: number): Promise<unknown> => {
		if (nextIndex <= index) throw new Error("RPC interceptor next() called multiple times")
		index = nextIndex
		const interceptor = interceptors[nextIndex]
		if (!interceptor) return handler()
		return interceptor(ctx, () => dispatch(nextIndex + 1))
	}
	return dispatch(0)
}

/** Create an RPC plugin from interceptor functions. */
export function middlewarePlugin(interceptors: readonly RPCInterceptor[]): RPCPlugin {
	return {
		name: "middleware",
		wrapHandler: async (ctx, next) => {
			const callCtx: RPCCallContext = {
				id: ctx.id,
				method: ctx.method,
				args: ctx.args,
				state: ctx.state
			}
			const result = await runInterceptors(interceptors, callCtx, async () => {
				ctx.args = callCtx.args
				return await next()
			})
			ctx.args = callCtx.args
			return result
		}
	}
}
