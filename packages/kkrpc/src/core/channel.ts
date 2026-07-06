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
}

type PendingRequest = {
	resolve(value: unknown): void
	reject(error: Error): void
	timer?: ReturnType<typeof setTimeout>
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
	private callbacks = new Map<string, (...args: unknown[]) => unknown>()
	protected destroyed = false
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
		this.supportsTransfer =
			options.enableTransfer !== false && transport.capabilities?.transfer === true
		this.timeout = options.timeout ?? 30_000
		this.unsubscribe = transport.subscribe((message) => void this.handleMessage(message))
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
		for (const pending of this.pending.values()) {
			if (pending.timer) clearTimeout(pending.timer)
			pending.reject(new Error("RPC channel destroyed"))
		}
		this.pending.clear()
		this.callbacks.clear()
		this.transport.close?.()
	}

	/** Create a remote proxy rooted at a protocol path. */
	protected createProxy(path: string[]): unknown {
		const target = function () {}
		return new Proxy(target, {
			get: (target, property, receiver) => {
				if (property === "then") {
					if (path.length === 0) return undefined
					const promise = this.request("get", path)
					return promise.then.bind(promise)
				}
				if (typeof property === "symbol") return Reflect.get(target, property, receiver)
				return this.createProxy([...path, property])
			},
			set: (_target, property, value) => {
				if (typeof property === "symbol") return false
				void this.request("set", [...path, property], undefined, value).catch(() => {})
				return true
			},
			apply: (_target, _thisArg, args) => this.request("call", path, Array.from(args)),
			construct: (_target, args) => this.request("new", path, Array.from(args))
		})
	}

	// Register the pending response before sending to avoid races with synchronous transports.
	/** Send one RPC request and return the pending response promise. */
	protected request(
		op: RPCOperation,
		path: string[],
		args?: unknown[],
		value?: unknown
	): Promise<unknown> {
		if (this.destroyed) return Promise.reject(new Error("RPC channel destroyed"))
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
		if (arguments.length >= 4) message.v = this.encodeValue(value, transfers)
		if (meta && Object.keys(meta).length > 0) message.meta = meta

		const promise = new Promise<unknown>((resolve, reject) => {
			const pending: PendingRequest = { resolve, reject }
			if (this.timeout > 0) {
				pending.timer = setTimeout(() => {
					this.pending.delete(id)
					const error = new Error(`RPC request ${id} timed out after ${this.timeout}ms`)
					error.name = "RPCTimeoutError"
					reject(error)
				}, this.timeout)
			}
			this.pending.set(id, pending)
		})

		this.post(message, transfers, id)
		return promise
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
			if (callback) void callback(...this.decodeArgs(message.a))
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
				const id = generateId()
				this.callbacks.set(id, arg as (...args: unknown[]) => unknown)
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
	// (and, later, lifecycle) lives in one place.
	/** Build a local function that forwards calls to a remote callback by id. */
	protected createCallbackFacade(id: string): (...args: unknown[]) => void {
		return (...callbackArgs: unknown[]) => {
			const transfers: Transferable[] = []
			this.post({ t: "cb", id, a: this.encodeArgs(callbackArgs, transfers) }, transfers)
		}
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
