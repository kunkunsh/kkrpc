/**
 * Plugin hook contexts and execution helpers for stable RPC channels.
 *
 * Hooks run while handling incoming requests: `onRequest` first, `wrapHandler`
 * around local API invocation, `onResponse` after success, and `onError` after
 * failure. Each request gets a shared mutable `state` bag for plugin coordination.
 */

import type { RPCOperation } from "./protocol.ts"

/** Plugin hooks invoked while a remote request is handled locally. */
export interface RPCPlugin {
	/** Optional plugin name for diagnostics. */
	name?: string
	/** Inspect or mutate the incoming request context before handler execution. */
	onRequest?(ctx: RPCRequestContext): void | Promise<void>
	/** Wrap local handler execution, optionally replacing or transforming the result. */
	wrapHandler?(ctx: RPCHandlerContext, next: () => Promise<unknown>): Promise<unknown>
	/** Inspect or mutate a successful response before it is serialized. */
	onResponse?(ctx: RPCResponseContext): void | Promise<void>
	/** Observe or replace an error before it is serialized. */
	onError?(ctx: RPCErrorContext): void | Promise<void>
}

/** Shared request state before the local handler is invoked. */
export interface RPCRequestContext {
	/** Request id. */
	id: string
	/** Operation being handled. */
	operation: RPCOperation
	/** Property path on the exposed local API. */
	path: string[]
	/** Dot-joined path, useful for logging and validation lookup. */
	method: string
	/** Decoded request arguments. */
	args: unknown[]
	/** Decoded setter value, present for `set` operations. */
	value?: unknown
	/** Per-request state shared across plugin hooks. */
	state: Record<string, unknown>
}

/** Request context passed to `wrapHandler` plugins. */
export interface RPCHandlerContext extends RPCRequestContext {
	/** The local API object exposed by this channel. */
	localAPI: object
}

/** Response state after the handler returns but before serialization. */
export interface RPCResponseContext {
	/** Request id. */
	id: string
	/** Operation that completed successfully. */
	operation: RPCOperation
	/** Property path on the exposed local API. */
	path: string[]
	/** Dot-joined path, useful for logging and validation lookup. */
	method: string
	/** Mutable result that will be sent to the caller. */
	result: unknown
	/** Per-request state shared across plugin hooks. */
	state: Record<string, unknown>
}

/** Error state after the handler/plugin chain throws. */
export interface RPCErrorContext {
	/** Request id. */
	id: string
	/** Operation that failed. */
	operation: RPCOperation
	/** Property path on the exposed local API. */
	path: string[]
	/** Dot-joined path, useful for logging and validation lookup. */
	method: string
	/** Mutable error that will be serialized if rethrown. */
	error: unknown
	/** Per-request state shared across plugin hooks. */
	state: Record<string, unknown>
}

/** Run `onRequest` hooks in registration order. */
export async function runRequestHooks(
	plugins: readonly RPCPlugin[],
	ctx: RPCRequestContext
): Promise<void> {
	for (const plugin of plugins) await plugin.onRequest?.(ctx)
}

/** Run `wrapHandler` hooks as an onion chain around the local handler. */
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
