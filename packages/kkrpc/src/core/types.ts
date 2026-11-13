/**
 * Public type transformation and validation primitives for kkrpc.
 * @module
 */

/**
 * Standard built-in object and buffer types whose prototype methods should not be traversed as RPC callbacks.
 */
export type Builtin =
	| Date
	| Error
	| RegExp
	| ArrayBuffer
	| SharedArrayBuffer
	| ArrayBufferView
	| Map<any, any>
	| Set<any>
	| WeakMap<any, any>
	| WeakSet<object>
	| Promise<any>
	| Generator<any, any, any>
	| AsyncGenerator<any, any, any>

/**
 * Any generic function signature.
 */
export type AnyFunction = (...args: any[]) => any

/**
 * Any generic constructor signature.
 */
export type AnyConstructor = new (...args: any[]) => any

/**
 * A remote property proxy handle.
 *
 * - Awaiting the property directly (`await api.property`) sends an RPC `get` request to fetch its remote value.
 * - Calling `.set(newValue)` sends an explicit RPC `set` request and returns a `Promise<void>` that settles when the update completes remotely.
 */
export type RemoteProperty<T> = Promise<T> & {
	set(value: T): Promise<void>
}

/**
 * Recursively transforms a value crossing the RPC boundary (such as method return values or closure values).
 *
 * - Plain primitives (string, number, boolean, etc.) and built-in objects (Date, ArrayBuffer) cross by value and are preserved as-is.
 * - Any function or closure (whether at root or nested inside returned objects/arrays)
 *   is decoded as a callable remote proxy and transformed so its invocation returns a `Promise`.
 * - If a closure returns another closure or an object containing functions, they are recursively transformed as well.
 */
export type RemoteValue<T> = T extends Builtin
	? T
	: T extends AnyFunction
		? (...args: Parameters<T>) => PromisifyReturn<ReturnType<T>>
		: T extends Array<infer E>
			? Array<RemoteValue<E>>
			: T extends ReadonlyArray<infer E>
				? ReadonlyArray<RemoteValue<E>>
				: T extends object
					? {
							[K in keyof T]: RemoteValue<T[K]>
						}
					: T

/**
 * Transform a function return type to a Promise, preserving existing Promises and AsyncIterables,
 * while recursively promisifying any function leaves inside returned objects, closures, or streams.
 */
export type PromisifyReturn<R> =
	R extends Promise<infer U>
		? Promise<RemoteValue<U>>
		: R extends AsyncIterable<infer U>
			? AsyncIterable<RemoteValue<U>>
			: Promise<RemoteValue<R>>

/**
 * Recursively transforms a local API interface into a type-safe remote RPC proxy client interface.
 *
 * - Methods returning `T` are transformed to return `Promise<RemoteValue<T>>`.
 * - Methods returning `Promise<T>` or `AsyncIterable<T>` are preserved while transforming leaf functions.
 * - Constructors returning `Instance` are transformed to return `Promise<RemoteValue<Instance>>`.
 * - Plain non-function leaf properties become `readonly RemoteProperty<T>` to reflect asynchronous
 *   property access (`await api.property`) and provide `.set(newValue)` for remote updates.
 * - Nested objects are recursively transformed without being wrapped in `Promise`,
 *   preserving chainable dot-access syntax (e.g. `api.math.add(1, 2)`).
 */
export type Remote<T> = T extends Builtin
	? RemoteProperty<T>
	: T extends new (...args: infer CA) => infer CR
		? T extends (...args: infer FA) => infer FR
			? ((...args: FA) => PromisifyReturn<FR>) & (new (...args: CA) => Promise<RemoteValue<CR>>)
			: new (...args: CA) => Promise<RemoteValue<CR>>
		: T extends (...args: infer FA) => infer FR
			? (...args: FA) => PromisifyReturn<FR>
			: T extends object
				? {
						readonly [K in keyof T]: T[K] extends Builtin
							? RemoteProperty<T[K]>
							: T[K] extends new (...args: infer CA) => infer CR
								? T[K] extends (...args: infer FA) => infer FR
									? ((...args: FA) => PromisifyReturn<FR>) &
											(new (...args: CA) => Promise<RemoteValue<CR>>)
									: new (...args: CA) => Promise<RemoteValue<CR>>
								: T[K] extends (...args: infer FA) => infer FR
									? (...args: FA) => PromisifyReturn<FR>
									: T[K] extends object
										? Remote<T[K]>
										: RemoteProperty<T[K]>
					}
				: RemoteProperty<T>

/**
 * Error branding type emitted when a callback in a one-way exposed API violates the `void` return constraint.
 */
export type OneWayCallbackError<
	Message extends
		string = "Callback in one-way exposed API must return void (fire-and-forget only, return values cannot be retrieved)"
> = {
	readonly __kkrpc_callback_error__: Message
}

/**
 * Error branding type emitted when a callback in a bidirectional exposed API violates the `Promise<any> | void` return constraint.
 */
export type BiDirectionalCallbackError<
	Message extends
		string = "Callback in bidirectional exposed API must return Promise<any> or void (synchronous return values are prohibited across RPC boundaries)"
> = {
	readonly __kkrpc_callback_error__: Message
}

/**
 * Error branding type emitted when an API exposed over HTTP includes callback arguments.
 */
export type HttpCallbackError<
	Message extends string = "HTTP transport does not support callback arguments"
> = {
	readonly __kkrpc_callback_error__: Message
}

/**
 * Recursively validate whether a type (parameter, option, or nested structure) contains only valid one-way callbacks.
 */
export type ValidateOneWayParam<T> = T extends Builtin
	? T
	: T extends AnyFunction
		? ReturnType<T> extends void | undefined
			? (...args: ValidateOneWayArgs<Parameters<T>>) => ReturnType<T>
			: (...args: Parameters<T>) => OneWayCallbackError
		: T extends Array<infer E>
			? Array<ValidateOneWayParam<E>>
			: T extends ReadonlyArray<infer E>
				? ReadonlyArray<ValidateOneWayParam<E>>
				: T extends object
					? { [K in keyof T]: ValidateOneWayParam<T[K]> }
					: T

/**
 * Recursively validate an argument tuple for one-way callbacks.
 */
export type ValidateOneWayArgs<T extends unknown[]> = T extends [infer Head, ...infer Tail]
	? [ValidateOneWayParam<Head>, ...ValidateOneWayArgs<Tail>]
	: T extends []
		? []
		: T extends Array<infer E>
			? Array<ValidateOneWayParam<E>>
			: T

/**
 * Constrain an exposed API object for one-way communication channels (default core `kkrpc`).
 * All callbacks in method parameters (and nested within parameter objects) must return `void`.
 */
export type ValidateOneWayAPI<T> = {
	[K in keyof T]: T[K] extends AnyFunction
		? (...args: ValidateOneWayArgs<Parameters<T[K]>>) => ReturnType<T[K]>
		: T[K] extends object
			? ValidateOneWayAPI<T[K]>
			: T[K]
}

/**
 * Recursively validate whether a type (parameter, option, or nested structure) contains only valid bidirectional callbacks.
 */
export type ValidateBiDirectionalParam<T> = T extends Builtin
	? T
	: T extends AnyFunction
		? ReturnType<T> extends Promise<any> | void | undefined
			? (...args: ValidateBiDirectionalArgs<Parameters<T>>) => ReturnType<T>
			: (...args: Parameters<T>) => BiDirectionalCallbackError
		: T extends Array<infer E>
			? Array<ValidateBiDirectionalParam<E>>
			: T extends ReadonlyArray<infer E>
				? ReadonlyArray<ValidateBiDirectionalParam<E>>
				: T extends object
					? { [K in keyof T]: ValidateBiDirectionalParam<T[K]> }
					: T

/**
 * Recursively validate an argument tuple for bidirectional callbacks.
 */
export type ValidateBiDirectionalArgs<T extends unknown[]> = T extends [infer Head, ...infer Tail]
	? [ValidateBiDirectionalParam<Head>, ...ValidateBiDirectionalArgs<Tail>]
	: T extends []
		? []
		: T extends Array<infer E>
			? Array<ValidateBiDirectionalParam<E>>
			: T

/**
 * Constrain an exposed API object for bidirectional communication channels (`kkrpc/remote-refs`).
 * All callbacks in method parameters (and nested within parameter objects) must return `Promise<any>` or `void`.
 */
export type ValidateBiDirectionalAPI<T> = {
	[K in keyof T]: T[K] extends AnyFunction
		? (...args: ValidateBiDirectionalArgs<Parameters<T[K]>>) => ReturnType<T[K]>
		: T[K] extends object
			? ValidateBiDirectionalAPI<T[K]>
			: T[K]
}

/**
 * Recursively validate whether a type contains any function/callback values (forbidden over unary HTTP).
 */
export type ValidateHttpParam<T> = T extends Builtin
	? T
	: T extends AnyFunction
		? HttpCallbackError
		: T extends Array<infer E>
			? Array<ValidateHttpParam<E>>
			: T extends ReadonlyArray<infer E>
				? ReadonlyArray<ValidateHttpParam<E>>
				: T extends object
					? { [K in keyof T]: ValidateHttpParam<T[K]> }
					: T

/**
 * Recursively validate an argument tuple for unary HTTP transport.
 */
export type ValidateHttpArgs<T extends unknown[]> = T extends [infer Head, ...infer Tail]
	? [ValidateHttpParam<Head>, ...ValidateHttpArgs<Tail>]
	: T extends []
		? []
		: T extends Array<infer E>
			? Array<ValidateHttpParam<E>>
			: T

/**
 * Constrain an exposed API object for unary HTTP transport (`kkrpc/http`).
 * Methods must not accept any callback or function arguments at any nesting level.
 */
export type ValidateHttpAPI<T> = {
	[K in keyof T]: T[K] extends AnyFunction
		? (...args: ValidateHttpArgs<Parameters<T[K]>>) => ReturnType<T[K]>
		: T[K] extends object
			? ValidateHttpAPI<T[K]>
			: T[K]
}
