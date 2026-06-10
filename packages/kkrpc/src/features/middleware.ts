/**
 * Receive-side middleware plugin for stable RPC channels.
 *
 * Middleware wraps local handler execution using an onion model. It is useful for
 * logging, authorization, metrics, argument inspection, or result transformation.
 *
 * ```ts
 * import { expose } from "kkrpc"
 * import { middlewarePlugin } from "kkrpc/middleware"
 *
 * expose(api, transport, { plugins: [middlewarePlugin([logger])] })
 * ```
 */

import type { RPCPlugin } from "../core/plugins.ts"
import type { RPCMessageMetadata } from "../core/protocol.ts"

/**
 * Mutable context shared by all middleware for one receive-side RPC call.
 *
 * `args` may be replaced before `next()` is called to transform handler input.
 * `state` is per-call scratch space for cross-cutting concerns such as auth,
 * logging metadata, metrics spans, or request-scoped caches.
 */
export interface RPCCallContext {
	id: string
	method: string
	args: unknown[]
	meta?: RPCMessageMetadata
	state: Record<string, unknown>
}

/**
 * Receive-side middleware function that wraps the next middleware or handler.
 *
 * Middleware runs in onion order: code before `await next()` executes on the way
 * in, and code after it executes on the way out. Returning without calling
 * `next()` short-circuits local handler invocation.
 */
export type MiddlewareHandler = (
	ctx: RPCCallContext,
	next: () => Promise<unknown>
) => Promise<unknown>

/**
 * Run middleware interceptors in onion order around a final handler.
 *
 * Throws if an interceptor calls the same `next()` more than once. This mirrors
 * common middleware frameworks and prevents duplicated RPC handler execution.
 */
export function runInterceptors(
	interceptors: readonly MiddlewareHandler[],
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

/**
 * Create an RPC plugin from receive-side middleware functions.
 *
 * The plugin wraps receive-side handler invocation for APIs exposed on this
 * channel. It does not run for outgoing calls made by this channel's remote API
 * proxy.
 */
export function middlewarePlugin(interceptors: readonly MiddlewareHandler[]): RPCPlugin {
	return {
		name: "middleware",
		wrapHandler: async (ctx, next) => {
			const callCtx: RPCCallContext = {
				id: ctx.id,
				method: ctx.method,
				args: ctx.args,
				meta: ctx.meta,
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
