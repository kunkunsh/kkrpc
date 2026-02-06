/**
 * Middleware / interceptor system for kkrpc.
 *
 * Interceptors wrap handler invocation on the receiving side (inside
 * `handleRequest`). They run **after** input validation and **before**
 * output validation, so they always see clean, validated data.
 *
 * Uses the standard onion model: each interceptor calls `next()` to
 * proceed to the next interceptor (or the actual handler at the end).
 * Interceptors can inspect/modify args, transform return values, measure
 * timing, enforce auth, or throw to abort the call.
 */

/**
 * Context passed to each interceptor.
 */
export interface RPCCallContext {
	/** Dotted method path, e.g. "math.grade1.add". */
	method: string
	/** Arguments after callback restoration and input validation. */
	args: unknown[]
	/** Extensible state bag — interceptors can attach data for downstream interceptors. */
	state: Record<string, unknown>
}

/**
 * An interceptor function.
 *
 * Call `next()` to proceed to the next interceptor (or the handler).
 * Return the result — you can transform it before returning.
 * Throw to abort the call (the error propagates to the caller).
 */
export type RPCInterceptor = (
	ctx: RPCCallContext,
	next: () => Promise<unknown>
) => Promise<unknown>

/**
 * Run an interceptor chain using the onion model.
 *
 * Builds a nested call chain: interceptor[0] → interceptor[1] → ... → handler.
 * Each interceptor's `next()` invokes the next one in the chain. The final
 * `next()` invokes `handler`.
 *
 * @param interceptors - Array of interceptor functions (executed in order)
 * @param ctx - The call context (shared across all interceptors)
 * @param handler - The actual method handler to invoke at the end of the chain
 */
export function runInterceptors(
	interceptors: ReadonlyArray<RPCInterceptor>,
	ctx: RPCCallContext,
	handler: () => Promise<unknown>
): Promise<unknown> {
	let index = 0
	const next = (): Promise<unknown> => {
		if (index >= interceptors.length) {
			return handler()
		}
		const interceptor = interceptors[index++]
		return interceptor(ctx, next)
	}
	return next()
}
