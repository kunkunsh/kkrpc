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
