/**
 * Core plugin lifecycle for kkrpc/next.
 *
 * Plugins are receive-side hooks around request handling. They can inspect or
 * mutate request arguments, wrap the local handler in onion order, adjust the
 * returned result, or replace errors before they are serialized. The channel
 * imports only these lightweight hook runners; concrete features such as
 * validation and middleware live in separate entry points.
 *
 * @example
 * ```ts
 * import { expose } from "kkrpc/next"
 * import type { RPCPlugin } from "kkrpc/next"
 *
 * const auditPlugin: RPCPlugin = {
 * 	name: "audit",
 * 	onRequest(ctx) {
 * 		console.log(ctx.method, ctx.args)
 * 	}
 * }
 *
 * expose(api, transport, { plugins: [auditPlugin] })
 * ```
 */

import type { RPCOperation } from "./protocol.ts"

/** Plugin hooks invoked while a remote request is handled locally. */
export interface RPCPlugin {
	name?: string
	onRequest?(ctx: RPCRequestContext): void | Promise<void>
	wrapHandler?(ctx: RPCHandlerContext, next: () => Promise<unknown>): Promise<unknown>
	onResponse?(ctx: RPCResponseContext): void | Promise<void>
	onError?(ctx: RPCErrorContext): void | Promise<void>
}

/** Shared request state before the local handler is invoked. */
export interface RPCRequestContext {
	id: string
	operation: RPCOperation
	path: string[]
	method: string
	args: unknown[]
	value?: unknown
	state: Record<string, unknown>
}

/** Request context passed to `wrapHandler` plugins. */
export interface RPCHandlerContext extends RPCRequestContext {
	localAPI: object
}

/** Response state after the handler returns but before serialization. */
export interface RPCResponseContext {
	id: string
	operation: RPCOperation
	path: string[]
	method: string
	result: unknown
	state: Record<string, unknown>
}

/** Error state after the handler/plugin chain throws. */
export interface RPCErrorContext {
	id: string
	operation: RPCOperation
	path: string[]
	method: string
	error: unknown
	state: Record<string, unknown>
}

/** Run `onRequest` hooks in registration order. */
export async function runRequestHooks(
	plugins: readonly RPCPlugin[],
	ctx: RPCRequestContext
): Promise<void> {
	for (const plugin of plugins) await plugin.onRequest?.(ctx)
}

/**
 * Wrap the local handler in plugin onion order.
 *
 * The first plugin receives the outermost `next()`. Calling the same `next()`
 * twice throws to prevent duplicated handler execution.
 */
export function runHandlerHooks(
	plugins: readonly RPCPlugin[],
	ctx: RPCHandlerContext,
	handler: () => Promise<unknown>
): Promise<unknown> {
	let index = -1
	const dispatch = (nextIndex: number): Promise<unknown> => {
		if (nextIndex <= index) throw new Error("RPC plugin next() called multiple times")
		index = nextIndex
		const plugin = plugins[nextIndex]
		if (!plugin) return handler()
		if (!plugin.wrapHandler) return dispatch(nextIndex + 1)
		return plugin.wrapHandler(ctx, () => dispatch(nextIndex + 1))
	}
	return dispatch(0)
}

/** Run `onResponse` hooks in registration order. */
export async function runResponseHooks(
	plugins: readonly RPCPlugin[],
	ctx: RPCResponseContext
): Promise<void> {
	for (const plugin of plugins) await plugin.onResponse?.(ctx)
}

/** Run `onError` hooks in registration order. */
export async function runErrorHooks(
	plugins: readonly RPCPlugin[],
	ctx: RPCErrorContext
): Promise<void> {
	for (const plugin of plugins) await plugin.onError?.(ctx)
}
