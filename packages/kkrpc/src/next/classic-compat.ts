/**
 * Migration facade that maps classic-style options onto kkrpc/next plugins.
 *
 * The facade is intentionally small: it composes validators and interceptors
 * into the vNext plugin array, then delegates to `RPCChannel`, `wrap()`, or
 * `expose()`. It does not import classic `RPCChannel` and it does not adapt
 * classic `IoInterface` transports. Callers still need a `Transport<RPCMessage>`.
 *
 * @example
 * ```ts
 * import { wrapCompat } from "kkrpc/next/classic-compat"
 *
 * const api = wrapCompat<MyAPI>(transport, {
 * 	validators,
 * 	interceptors: [async (ctx, next) => await next()]
 * })
 * ```
 */

import { expose, RPCChannel, wrap, type ExposedController, type RPCChannelOptions } from "./index.ts"
import { middlewarePlugin, type RPCInterceptor } from "./middleware.ts"
import type { RPCMessage } from "./protocol.ts"
import type { RPCPlugin } from "./plugins.ts"
import type { Transport } from "./transport.ts"
import { validationPlugin, type RPCValidators } from "./validation.ts"

export interface ClassicCompatOptions<LocalAPI extends object = object>
	extends RPCChannelOptions<LocalAPI> {
	validators?: RPCValidators<LocalAPI> | Record<string, unknown>
	interceptors?: RPCInterceptor[]
}

/**
 * Convert classic-style validator/interceptor options into vNext plugins.
 *
 * Generated plugins always run before explicitly supplied plugins: validation
 * first, middleware second, then custom plugins. This keeps migration behavior
 * predictable while still allowing advanced plugin composition.
 */
export function classicPlugins<LocalAPI extends object>(
	options: Pick<ClassicCompatOptions<LocalAPI>, "validators" | "interceptors" | "plugins">
): RPCPlugin[] {
	const plugins: RPCPlugin[] = []
	if (options.validators) plugins.push(validationPlugin(options.validators))
	if (options.interceptors?.length) plugins.push(middlewarePlugin(options.interceptors))
	plugins.push(...(options.plugins ?? []))
	return plugins
}

function toChannelOptions<LocalAPI extends object>(
	options: ClassicCompatOptions<LocalAPI> = {}
): RPCChannelOptions<LocalAPI> {
	return {
		expose: options.expose,
		timeout: options.timeout,
		enableTransfer: options.enableTransfer,
		plugins: classicPlugins(options)
	}
}

/** Create an `RPCChannel` using classic-style validation and middleware options. */
export function createCompatChannel<
	LocalAPI extends object = object,
	RemoteAPI extends object = object
>(
	transport: Transport<RPCMessage>,
	options: ClassicCompatOptions<LocalAPI> = {}
): RPCChannel<LocalAPI, RemoteAPI> {
	return new RPCChannel<LocalAPI, RemoteAPI>(transport, toChannelOptions(options))
}

/**
 * Wrap a remote API using classic-style options.
 *
 * @example
 * ```ts
 * const api = wrapCompat<{ ping(): Promise<string> }>(transport, {
 * 	interceptors: [async (ctx, next) => await next()]
 * })
 * ```
 */
export function wrapCompat<RemoteAPI extends object = object>(
	transport: Transport<RPCMessage>,
	options: Omit<ClassicCompatOptions<object>, "expose"> = {}
): RemoteAPI {
	return wrap<RemoteAPI>(transport, { ...options, plugins: classicPlugins(options) })
}

/**
 * Expose a local API using classic-style options.
 *
 * @example
 * ```ts
 * const controller = exposeCompat({ ping: () => "pong" }, transport, { validators })
 * controller.dispose()
 * ```
 */
export function exposeCompat<LocalAPI extends object, RemoteAPI extends object = object>(
	api: LocalAPI,
	transport: Transport<RPCMessage>,
	options: Omit<ClassicCompatOptions<LocalAPI>, "expose"> = {}
): ExposedController<LocalAPI, RemoteAPI> {
	return expose<LocalAPI, RemoteAPI>(api, transport, {
		...options,
		plugins: classicPlugins(options)
	})
}
