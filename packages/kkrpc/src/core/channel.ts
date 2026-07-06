/**
 * Core bidirectional RPC channel implementation.
 *
 * `RPCChannel` owns one `Transport<RPCMessage>`, exposes an optional local API,
 * and creates a proxy for the remote API. It handles request/response matching,
 * callback argument routing, transfer descriptors, timeouts, plugin hooks, and
 * lifecycle cleanup.
 *
 * ```ts
 * import { RPCChannel } from "kkrpc"
 *
 * const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { expose: localAPI })
 * const remote = channel.getAPI()
 * await remote.ping()
 * channel.destroy()
 * ```
 */

import {
	runErrorHooks,
	runHandlerHooks,
	runRequestHooks,
	runResponseHooks,
	type RPCPlugin
} from "./plugins.ts"
import type {
	RPCCallback,
	RPCCallbackRelease,
	RPCError,
	RPCMessage,
	RPCMessageMetadata,
	RPCOperation,
	RPCRequest,
	RPCResponse
} from "./protocol.ts"
import { takeTransferDescriptor } from "./transfer.ts"
import type { Transport } from "./transport.ts"
import { generateId } from "./utils.ts"

/** Options used to configure an `RPCChannel`. */
export interface RPCChannelOptions<LocalAPI extends object = object> {
	/** Local API object to expose to the remote side. */
	expose?: LocalAPI
	/** Request timeout in milliseconds. Set to `0` to disable timeouts. */
	timeout?: number
	/** Disable transferable forwarding even when the transport supports it. */
	enableTransfer?: boolean
	/** Plugins that run while handling incoming requests. */
	plugins?: RPCPlugin[]
	/** Optional provider for protocol-level metadata on outgoing request messages. */
	getMetadata?: () => RPCMessageMetadata | undefined
	/**
	 * Called once when the underlying transport reports the connection closed
	 * (remote close or network error), after pending requests have been rejected.
	 * `reason` is an `Error` for abnormal termination, `undefined` for a clean
	 * close. Requires a transport that implements `onClose`; otherwise never fires.
	 * The channel is not destroyed — reconnect by creating a new transport and
	 * channel.
	 */
	onClose?: (reason?: Error) => void
	/**
	 * Observe errors from fire-and-forget paths that would otherwise be swallowed:
	 * a failed `set` on a remote proxy (`kind: "set"`) and a thrown/rejected local
	 * callback invocation (`kind: "callback"`). Purely for diagnostics; without it
	 * these paths stay silent as before.
	 */
	onUncaughtError?: (error: Error, context: { kind: "set" | "callback"; path?: string[] }) => void
}

type PendingRequest = {
	resolve(value: unknown): void
	reject(error: Error): void
	timer?: ReturnType<typeof setTimeout>
	/** Removes any per-call abort listener when the request settles. */
	cleanup?: () => void
}

/** Per-call overrides applied to a proxy created with `withCallOptions`. */
export interface CallOptions {
	/** Timeout in milliseconds for calls made through this proxy. Overrides the channel default; `0` disables. */
	timeout?: number
	/** Abort signal that rejects in-flight calls made through this proxy. */
	signal?: AbortSignal
}

// Marks "no value argument" so `set` can be distinguished from other operations
// without relying on argument count (which per-call options would otherwise break).
// Exported for subclass request() overrides; not part of the public entry surface.
export const NO_VALUE = Symbol("kkrpc.noValue")

/** Symbol used to derive a per-call-options proxy from an existing remote proxy. Exported for subclass createProxy() overrides. */
export const CALL_OPTIONS = Symbol("kkrpc.callOptions")

/** Normalize an aborted signal into a rejection error. Exported for subclass request() overrides. */
export function toAbortError(signal: AbortSignal): Error {
	const reason = (signal as AbortSignal & { reason?: unknown }).reason
	if (reason instanceof Error) return reason
	const error = new Error(typeof reason === "string" ? reason : "The operation was aborted")
	error.name = "AbortError"
	return error
}

const RPC_OPERATIONS = new Set<RPCOperation>(["call", "get", "set", "new"])

// Callback and value arguments are wrapped so user data cannot be confused with callback markers.
const ARG_ENVELOPE_TAG = "__kkrpc_next_arg__"

type ValueArgEnvelope = {
	[ARG_ENVELOPE_TAG]: "value"
	v: unknown
}

type CallbackArgEnvelope = {
	[ARG_ENVELOPE_TAG]: "callback"
	id: string
}

type ArgEnvelope = ValueArgEnvelope | CallbackArgEnvelope

function isArgEnvelope(value: unknown): value is ArgEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		ARG_ENVELOPE_TAG in value &&
		((value as { [ARG_ENVELOPE_TAG]: unknown })[ARG_ENVELOPE_TAG] === "value" ||
			(value as { [ARG_ENVELOPE_TAG]: unknown })[ARG_ENVELOPE_TAG] === "callback")
	)
}

// Transports may share non-kkrpc frames; malformed frames are ignored by these guards.
function isRPCRequestMessage(value: unknown): value is RPCRequest {
	if (typeof value !== "object" || value === null) return false
	const message = value as Partial<RPCRequest>
	return (
		message.t === "q" &&
		typeof message.id === "string" &&
		typeof message.op === "string" &&
		RPC_OPERATIONS.has(message.op as RPCOperation) &&
		Array.isArray(message.p) &&
		message.p.every((segment) => typeof segment === "string") &&
		(message.a === undefined || Array.isArray(message.a))
	)
}

function isUnsupportedRPCRefRequestMessage(value: unknown): value is RPCRequest {
	if (typeof value !== "object" || value === null) return false
	const message = value as Partial<RPCRequest>
	return (
		message.t === "q" &&
		typeof message.id === "string" &&
		message.op === "ref" &&
		Array.isArray(message.p) &&
		message.p.every((segment) => typeof segment === "string") &&
		(message.a === undefined || Array.isArray(message.a))
	)
}

// Transports may share non-kkrpc frames; malformed frames are ignored by these guards.
function isRPCResponseMessage(value: unknown): value is RPCResponse {
	if (typeof value !== "object" || value === null) return false
	const message = value as Partial<RPCResponse>
	return message.t === "r" && typeof message.id === "string"
}

// Transports may share non-kkrpc frames; malformed frames are ignored by these guards.
function isRPCCallbackMessage(value: unknown): value is RPCCallback {
	if (typeof value !== "object" || value === null) return false
	const message = value as Partial<RPCCallback>
	return message.t === "cb" && typeof message.id === "string" && Array.isArray(message.a)
}

// Transports may share non-kkrpc frames; malformed frames are ignored by these guards.
function isRPCCallbackReleaseMessage(value: unknown): value is RPCCallbackRelease {
	if (typeof value !== "object" || value === null) return false
	const message = value as Partial<RPCCallbackRelease>
	return (
		message.t === "cbr" &&
		Array.isArray(message.ids) &&
		message.ids.every((id) => typeof id === "string")
	)
}

// Callback GC needs both primitives; runtimes without them keep today's behavior
// (callback registry entries live until the channel is destroyed).
const supportsCallbackGC =
	typeof FinalizationRegistry === "function" && typeof WeakRef === "function"

// Metadata attached to every decoded callback facade so releaseCallback() can act
// on it. Populated on all runtimes; independent of FinalizationRegistry support.
type CallbackFacadeRecord = { id: string; released: boolean; release(): void }
const callbackFacadeRecords = new WeakMap<object, CallbackFacadeRecord>()

/** Raised when a callback facade is invoked after it has been released. */
export class RPCCallbackReleasedError extends Error {
	constructor(id: string) {
		super(`RPC callback ${id} has been released`)
		this.name = "RPCCallbackReleasedError"
	}
}

/** Rejection reason for pending requests when the transport connection closes. */
export class RPCTransportClosedError extends Error {
	constructor(reason?: Error) {
		super(reason ? `RPC transport closed: ${reason.message}` : "RPC transport closed")
		this.name = "RPCTransportClosedError"
		if (reason) (this as Error & { cause?: unknown }).cause = reason
	}
}

/**
 * Deterministically release a decoded callback facade.
 *
 * Mirrors `releaseProxy` from `kkrpc/remote-refs`: it tells the owning channel to
 * drop the callback's registry entry and marks the local facade unusable. This is
 * idempotent and safe on non-facade values (returns `false`). On runtimes without
 * `FinalizationRegistry` it is the only way to free the owner-side entry, since
 * automatic collection is unavailable there.
 */
export function releaseCallback(callback: unknown): boolean {
	if (typeof callback !== "function") return false
	const record = callbackFacadeRecords.get(callback)
	if (!record) return false
	record.release()
	return true
}

/**
 * Derive a remote proxy whose calls use per-call `timeout` and/or `AbortSignal`
 * overrides, without changing the channel default.
 *
 * ```ts
 * const api = wrap<RemoteAPI>(transport)
 * const quick = withCallOptions(api, { timeout: 2000 })
 * await quick.slowThing() // rejects after 2s instead of the channel timeout
 *
 * const controller = new AbortController()
 * const cancelable = withCallOptions(api, { signal: controller.signal })
 * cancelable.longRunning().catch(() => {})
 * controller.abort()
 * ```
 *
 * The options apply to every call made through the returned proxy (and nested
 * property proxies derived from it). Throws if the value is not a kkrpc remote proxy.
 */
export function withCallOptions<T extends object>(api: T, options: CallOptions): T {
	const derive = (api as Record<symbol, unknown>)[CALL_OPTIONS]
	if (typeof derive !== "function") {
		throw new TypeError("withCallOptions requires a remote proxy created by wrap()/getAPI()")
	}
	return (derive as (options: CallOptions) => T)(options)
}

export function toRPCError(error: unknown): RPCError {
	if (error instanceof Error) {
		const result: RPCError = { n: error.name, m: error.message, s: error.stack }
		const errorRecord = error as Error & Record<string, unknown>
		for (const key in errorRecord) {
			if (key === "name" || key === "message" || key === "stack") continue
			result[key] = errorRecord[key]
		}
		return result
	}
	return { n: "Error", m: String(error) }
}

export function fromRPCError(error: RPCError): Error {
	const result = new Error(error.m)
	result.name = error.n
	if (error.s) result.stack = error.s
	for (const key in error) {
		if (key === "n" || key === "m" || key === "s") continue
		Object.assign(result, { [key]: error[key] })
	}
	return result
}

export function getPath(root: unknown, path: string[]): unknown {
	let current = root
	for (const segment of path) {
		if (current === null || current === undefined) {
			throw new Error(`Cannot access ${segment} on ${String(current)}`)
		}
		current = Reflect.get(Object(current), segment)
	}
	return current
}

export function getParent(root: unknown, path: string[]): { parent: object; key: string } {
	if (path.length === 0) throw new Error("Cannot set empty path")
	const parent = getPath(root, path.slice(0, -1))
	if (parent === null || parent === undefined) {
		throw new Error(`Cannot set ${path.join(".")} on ${String(parent)}`)
	}
	return { parent: Object(parent), key: path[path.length - 1] }
}

/**
 * Owns one RPC transport, exposes an optional local API, and creates a typed remote proxy.
 */
export class RPCChannel<LocalAPI extends object = object, RemoteAPI extends object = object> {
	// Owner side: callback id -> the local function invoked when a `cb` message arrives.
	private callbacks = new Map<string, (...args: unknown[]) => unknown>()
	// Owner side: dedup so the same function passed repeatedly reuses one id.
	private callbackIds = new WeakMap<(...args: unknown[]) => unknown, string>()
	// Receiver side: callback id -> the single live facade for that id (GC runtimes only).
	private callbackFacades?: Map<string, WeakRef<(...args: unknown[]) => void>>
	private facadeRegistry?: FinalizationRegistry<string>
	// Ids whose facades were collected/released, batched into one `cbr` per microtask.
	private pendingCallbackReleases = new Set<string>()
	private callbackReleaseScheduled = false
	protected destroyed = false
	// Set once the transport reports the connection closed; requests then fail fast.
	protected closed = false
	protected closeReason?: Error
	private unsubscribeClose?: () => void
	private onCloseHandler?: (reason?: Error) => void
	private onUncaughtError?: RPCChannelOptions<LocalAPI>["onUncaughtError"]
	protected pending: Map<string, PendingRequest> = new Map<string, PendingRequest>()
	protected supportsTransfer: boolean
	private unsubscribe: () => void
	protected timeout: number
	protected expose?: LocalAPI
	protected plugins: readonly RPCPlugin[]
	protected getMetadata?: () => RPCMessageMetadata | undefined

	/**
	 * Create a channel over one transport.
	 *
	 * The constructor subscribes immediately so incoming messages can be handled as
	 * soon as the transport starts delivering them.
	 */
	constructor(
		protected transport: Transport<RPCMessage>,
		options: RPCChannelOptions<LocalAPI> = {}
	) {
		this.expose = options.expose
		this.plugins = options.plugins ?? []
		this.getMetadata = options.getMetadata
		this.onCloseHandler = options.onClose
		this.onUncaughtError = options.onUncaughtError
		this.supportsTransfer =
			options.enableTransfer !== false && transport.capabilities?.transfer === true
		this.timeout = options.timeout ?? 30_000
		if (supportsCallbackGC) {
			this.callbackFacades = new Map()
			this.facadeRegistry = new FinalizationRegistry((id: string) => {
				// A newer facade may have been decoded for this id after the dead one was
				// collected; only release when no live facade remains (WeakRef re-reg guard).
				if (this.callbackFacades?.get(id)?.deref() !== undefined) return
				this.callbackFacades?.delete(id)
				this.queueCallbackRelease(id)
			})
		}
		this.unsubscribe = transport.subscribe((message) => void this.handleMessage(message))
		this.unsubscribeClose = transport.onClose?.((reason) => this.handleTransportClose(reason))
	}

	/**
	 * Reject all pending requests when the transport connection closes.
	 *
	 * Subsequent requests fail fast with `RPCTransportClosedError`. The channel is
	 * not destroyed: the exposed API, plugins, and callback registry stay intact so
	 * the instance can still be inspected. Reconnect by creating a new transport and
	 * channel. Overridden by `StreamingRPCChannel` to also fail stream state.
	 */
	protected handleTransportClose(reason?: Error): void {
		if (this.destroyed || this.closed) return
		this.closed = true
		this.closeReason = reason
		const error = new RPCTransportClosedError(reason)
		for (const pending of this.pending.values()) {
			if (pending.timer) clearTimeout(pending.timer)
			pending.cleanup?.()
			pending.reject(error)
		}
		this.pending.clear()
		try {
			this.onCloseHandler?.(reason)
		} catch {
			// An application close handler must not break channel teardown.
		}
	}

	/** Return a typed proxy that sends operations to the remote API. */
	getAPI(): RemoteAPI {
		return this.createProxy([]) as RemoteAPI
	}

	/** Close the transport subscription, reject pending calls, and release callback records. */
	destroy(): void {
		if (this.destroyed) return
		this.destroyed = true
		this.unsubscribe()
		this.unsubscribeClose?.()
		for (const pending of this.pending.values()) {
			if (pending.timer) clearTimeout(pending.timer)
			pending.cleanup?.()
			pending.reject(new Error("RPC channel destroyed"))
		}
		this.pending.clear()
		this.callbacks.clear()
		this.callbackFacades?.clear()
		this.pendingCallbackReleases.clear()
		this.transport.close?.()
	}

	/** Create a remote proxy rooted at a protocol path, optionally with per-call options. */
	protected createProxy(path: string[], callOptions?: CallOptions): unknown {
		const target = function () {}
		return new Proxy(target, {
			get: (target, property, receiver) => {
				if (property === CALL_OPTIONS) {
					return (options: CallOptions) => this.createProxy(path, options)
				}
				if (property === "then") {
					if (path.length === 0) return undefined
					const promise = this.request("get", path, undefined, NO_VALUE, callOptions)
					return promise.then.bind(promise)
				}
				if (typeof property === "symbol") return Reflect.get(target, property, receiver)
				return this.createProxy([...path, property], callOptions)
			},
			set: (_target, property, value) => {
				if (typeof property === "symbol") return false
				const setPath = [...path, property]
				void this.request("set", setPath, undefined, value, callOptions).catch((error) =>
					this.reportUncaughtError(error, { kind: "set", path: setPath })
				)
				return true
			},
			apply: (_target, _thisArg, args) =>
				this.request("call", path, Array.from(args), NO_VALUE, callOptions),
			construct: (_target, args) =>
				this.request("new", path, Array.from(args), NO_VALUE, callOptions)
		})
	}

	// Register the pending response before sending to avoid races with synchronous transports.
	/** Send one RPC request and return the pending response promise. */
	protected request(
		op: RPCOperation,
		path: string[],
		args?: unknown[],
		value: unknown = NO_VALUE,
		callOptions?: CallOptions
	): Promise<unknown> {
		if (this.destroyed) return Promise.reject(new Error("RPC channel destroyed"))
		if (this.closed) return Promise.reject(new RPCTransportClosedError(this.closeReason))
		if (callOptions?.signal?.aborted) return Promise.reject(toAbortError(callOptions.signal))
		let meta: RPCMessageMetadata | undefined
		try {
			meta = this.getMetadata?.()
		} catch (error) {
			return Promise.reject(error instanceof Error ? error : new Error(String(error)))
		}
		const id = generateId()
		const transfers: Transferable[] = []
		const message: RPCRequest = { t: "q", id, op, p: path }
		if (args) message.a = this.encodeArgs(args, transfers)
		if (value !== NO_VALUE) message.v = this.encodeValue(value, transfers)
		if (meta && Object.keys(meta).length > 0) message.meta = meta

		const promise = new Promise<unknown>((resolve, reject) => {
			this.armPending(id, { resolve, reject }, reject, callOptions)
		})

		this.post(message, transfers, id)
		return promise
	}

	/** Report an error from a fire-and-forget path to the optional diagnostics hook. */
	protected reportUncaughtError(
		error: unknown,
		context: { kind: "set" | "callback"; path?: string[] }
	): void {
		if (!this.onUncaughtError) return
		try {
			this.onUncaughtError(error instanceof Error ? error : new Error(String(error)), context)
		} catch {
			// A diagnostics hook must not break the path that reported to it.
		}
	}

	// Register a pending request with its timeout and optional abort wiring.
	/** Store a pending request and arm its timeout and abort-signal handlers. */
	protected armPending(
		id: string,
		pending: PendingRequest,
		reject: (error: Error) => void,
		callOptions?: CallOptions
	): void {
		const timeout = callOptions?.timeout ?? this.timeout
		if (timeout > 0) {
			pending.timer = setTimeout(() => {
				const current = this.pending.get(id)
				this.pending.delete(id)
				current?.cleanup?.()
				const error = new Error(`RPC request ${id} timed out after ${timeout}ms`)
				error.name = "RPCTimeoutError"
				reject(error)
			}, timeout)
		}
		const signal = callOptions?.signal
		if (signal) {
			const onAbort = () => {
				const current = this.pending.get(id)
				this.pending.delete(id)
				if (current?.timer) clearTimeout(current.timer)
				reject(toAbortError(signal))
			}
			signal.addEventListener("abort", onAbort, { once: true })
			pending.cleanup = () => signal.removeEventListener("abort", onAbort)
		}
		this.pending.set(id, pending)
	}

	// If a transport write fails, reject the matching pending request instead of waiting for timeout.
	/** Send one protocol message and reject the pending request on write failure. */
	protected post(
		message: RPCMessage,
		transfers: Transferable[] = [],
		pendingId?: string,
		onWriteError?: (error: Error) => void
	): void | Promise<void> {
		try {
			const result = this.transport.send(message, transfers)
			if (result instanceof Promise) {
				return result.catch((error) => this.handleWriteFailure(pendingId, error, onWriteError))
			}
		} catch (error) {
			this.handleWriteFailure(pendingId, error, onWriteError)
		}
	}

	/** Dispatch transport write failures to request waiters. */
	protected handleWriteFailure(
		pendingId: string | undefined,
		error: unknown,
		onWriteError?: (error: Error) => void
	): void {
		const normalized = error instanceof Error ? error : new Error(String(error))
		onWriteError?.(normalized)
		this.rejectPendingWrite(pendingId, normalized)
	}

	/** Reject a pending request when its transport write fails. */
	protected rejectPendingWrite(pendingId: string | undefined, error: unknown): void {
		if (!pendingId) return
		const pending = this.pending.get(pendingId)
		if (!pending) return
		this.pending.delete(pendingId)
		if (pending.timer) clearTimeout(pending.timer)
		pending.cleanup?.()
		pending.reject(error instanceof Error ? error : new Error(String(error)))
	}

	/** Dispatch one incoming protocol message by message kind. */
	protected async handleMessage(message: RPCMessage): Promise<void> {
		if (this.destroyed) return
		if (isRPCResponseMessage(message)) {
			this.handleResponse(message.id, message.v, message.e)
			return
		}
		if (isRPCCallbackMessage(message)) {
			const callback = this.callbacks.get(message.id)
			if (callback) {
				try {
					const result = callback(...this.decodeArgs(message.a))
					if (result instanceof Promise) {
						result.catch((error) => this.reportUncaughtError(error, { kind: "callback" }))
					}
				} catch (error) {
					this.reportUncaughtError(error, { kind: "callback" })
				}
			}
			return
		}
		if (isRPCCallbackReleaseMessage(message)) {
			for (const id of message.ids) {
				const fn = this.callbacks.get(id)
				this.callbacks.delete(id)
				if (fn) this.callbackIds.delete(fn)
			}
			return
		}
		if (isUnsupportedRPCRefRequestMessage(message)) {
			this.post({
				t: "r",
				id: message.id,
				e: { n: "Error", m: "Remote reference operations require kkrpc/remote-refs" }
			})
			return
		}
		if (isRPCRequestMessage(message)) await this.handleRequest(message)
	}

	/** Resolve or reject the pending request associated with a response. */
	protected handleResponse(id: string, value: unknown, error?: RPCError): void {
		const pending = this.pending.get(id)
		if (!pending) return
		this.pending.delete(id)
		if (pending.timer) clearTimeout(pending.timer)
		pending.cleanup?.()
		if (error) {
			pending.reject(fromRPCError(error))
			return
		}
		pending.resolve(this.decodeValue(value))
	}

	/** Execute an incoming request and post a protocol response. */
	protected async handleRequest(message: RPCRequest): Promise<void> {
		const transfers: Transferable[] = []
		try {
			const value = await this.executeRequest(message)
			if (this.destroyed) return
			this.post({ t: "r", id: message.id, v: this.encodeValue(value, transfers) }, transfers)
		} catch (error) {
			if (this.destroyed) return
			this.post({ t: "r", id: message.id, e: toRPCError(error) })
		}
	}

	/** Run plugin hooks and invoke the local API for one incoming request. */
	protected async executeRequest(message: RPCRequest): Promise<unknown> {
		if (!this.expose) throw new Error("No API exposed")
		const state: Record<string, unknown> = {}
		const requestCtx = {
			id: message.id,
			operation: message.op,
			path: message.p,
			method: message.p.join("."),
			args: this.decodeArgs(message.a ?? []),
			value: this.decodeValue(message.v),
			meta: message.meta,
			state
		}
		try {
			await runRequestHooks(this.plugins, requestCtx)
			const handlerCtx = { ...requestCtx, localAPI: this.expose as object }
			const result = await runHandlerHooks(this.plugins, handlerCtx, () =>
				this.invokeRequest(handlerCtx)
			)
			const responseCtx = {
				id: message.id,
				operation: message.op,
				path: message.p,
				method: message.p.join("."),
				result,
				meta: message.meta,
				state
			}
			await runResponseHooks(this.plugins, responseCtx)
			return responseCtx.result
		} catch (error) {
			const errorCtx = {
				id: message.id,
				operation: message.op,
				path: message.p,
				method: message.p.join("."),
				error,
				meta: message.meta,
				state
			}
			await runErrorHooks(this.plugins, errorCtx)
			throw errorCtx.error
		}
	}

	/** Invoke the exposed local API according to one compact RPC operation. */
	protected async invokeRequest(ctx: {
		operation: RPCOperation
		path: string[]
		args: unknown[]
		value?: unknown
	}): Promise<unknown> {
		if (!this.expose) throw new Error("No API exposed")
		if (ctx.operation === "ref") {
			throw new Error("Remote reference operations require kkrpc/remote-refs")
		}
		if (ctx.operation === "get") return getPath(this.expose, ctx.path)
		if (ctx.operation === "set") {
			const { parent, key } = getParent(this.expose, ctx.path)
			Reflect.set(parent, key, ctx.value)
			return true
		}
		const target = getPath(this.expose, ctx.path)
		if (ctx.operation === "new") {
			return Reflect.construct(target as new (...args: unknown[]) => unknown, ctx.args)
		}
		if (typeof target !== "function") throw new Error(`${ctx.path.join(".")} is not a function`)
		const receiver = ctx.path.length > 0 ? getPath(this.expose, ctx.path.slice(0, -1)) : undefined
		return await Reflect.apply(target, receiver, ctx.args)
	}

	// Function arguments become callback records that can be invoked later by callback id.
	/** Encode call arguments into value and callback envelopes. */
	protected encodeArgs(args: unknown[], transfers: Transferable[]): unknown[] {
		return args.map((arg) => {
			if (typeof arg === "function") {
				const fn = arg as (...args: unknown[]) => unknown
				// Dedup so the same function reuses one id across calls; re-register on
				// every encode so a callback released while a re-send was in flight is
				// resurrected (the release race is self-healing, see RPCCallbackRelease).
				let id = this.callbackIds.get(fn)
				if (id === undefined) {
					id = generateId()
					this.callbackIds.set(fn, id)
				}
				this.callbacks.set(id, fn)
				return { [ARG_ENVELOPE_TAG]: "callback", id } satisfies CallbackArgEnvelope
			}
			return {
				[ARG_ENVELOPE_TAG]: "value",
				v: this.encodeValue(arg, transfers)
			} satisfies ValueArgEnvelope
		})
	}

	// Callback records decode to functions that route calls back through the channel by id.
	/** Decode value and callback envelopes into local call arguments. */
	protected decodeArgs(args: unknown[]): unknown[] {
		return args.map((arg) => {
			if (!isArgEnvelope(arg)) return arg
			if (arg[ARG_ENVELOPE_TAG] === "value") return this.decodeValue(arg.v)
			if (arg[ARG_ENVELOPE_TAG] === "callback") return this.createCallbackFacade(arg.id)
		})
	}

	// A decoded callback envelope becomes a facade that routes invocations back to
	// the owner by callback id. Shared by every channel variant so callback routing
	// and lifecycle live in one place.
	/** Build a local function that forwards calls to a remote callback by id. */
	protected createCallbackFacade(id: string): (...args: unknown[]) => void {
		// Receiver-side dedup: at most one live facade per id, so decoding the same
		// callback twice yields the identical function and no GC race can release an
		// id whose facade is still alive.
		const existing = this.callbackFacades?.get(id)?.deref()
		if (existing) return existing

		const record: CallbackFacadeRecord = {
			id,
			released: false,
			release: () => {
				if (record.released) return
				record.released = true
				this.facadeRegistry?.unregister(facade)
				if (this.callbackFacades?.get(id)?.deref() === facade) this.callbackFacades.delete(id)
				this.queueCallbackRelease(id)
			}
		}
		const facade = (...callbackArgs: unknown[]) => {
			if (record.released) throw new RPCCallbackReleasedError(id)
			const transfers: Transferable[] = []
			this.post({ t: "cb", id, a: this.encodeArgs(callbackArgs, transfers) }, transfers)
		}
		callbackFacadeRecords.set(facade, record)
		if (this.callbackFacades && this.facadeRegistry) {
			this.callbackFacades.set(id, new WeakRef(facade))
			this.facadeRegistry.register(facade, id, facade)
		}
		return facade
	}

	// Batch collected/released callback ids into one `cbr` message per microtask.
	// Finalizer callbacks from one GC cycle collapse into a single release message.
	/** Queue a callback id for release notification to its owner. */
	private queueCallbackRelease(id: string): void {
		if (this.destroyed) return
		this.pendingCallbackReleases.add(id)
		if (this.callbackReleaseScheduled) return
		this.callbackReleaseScheduled = true
		queueMicrotask(() => {
			this.callbackReleaseScheduled = false
			if (this.destroyed || this.pendingCallbackReleases.size === 0) return
			const ids = [...this.pendingCallbackReleases]
			this.pendingCallbackReleases.clear()
			this.post({ t: "cbr", ids })
		})
	}

	// Transfer descriptors are consumed only when this channel and transport advertise transfer support.
	/** Encode a value and collect transferables when the transport supports them. */
	protected encodeValue(value: unknown, transfers: Transferable[]): unknown {
		const descriptor = this.supportsTransfer ? takeTransferDescriptor(value) : undefined
		if (!descriptor) return value
		transfers.push(...descriptor.transfers)
		return descriptor.value
	}

	/** Decode one value. Subclasses may override for opt-in feature envelopes. */
	protected decodeValue(value: unknown): unknown {
		return value
	}
}
