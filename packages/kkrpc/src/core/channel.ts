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

import { takeTransferDescriptor } from "./transfer.ts"
import type {
	RPCCallback,
	RPCError,
	RPCMessage,
	RPCMessageMetadata,
	RPCOperation,
	RPCRequest,
	RPCResponse,
	RPCStreamOperation,
	RPCStreamRequest,
	RPCStreamResponse
} from "./protocol.ts"
import {
	runErrorHooks,
	runHandlerHooks,
	runRequestHooks,
	runResponseHooks,
	type RPCPlugin
} from "./plugins.ts"
import type { Transport } from "./transport.ts"

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
const RPC_STREAM_OPERATIONS = new Set<RPCStreamOperation>(["pull", "return", "throw"])
const STREAM_CREDIT_WINDOW = 32
const STREAM_CREDIT_REPLENISH = 16

// Callback and value arguments are wrapped so user data cannot be confused with callback markers.
const ARG_ENVELOPE_TAG = "__kkrpc_next_arg__"
const STREAM_REF_TAG = "__kkrpc_next_stream__"

type ValueArgEnvelope = {
	[ARG_ENVELOPE_TAG]: "value"
	v: unknown
}

type CallbackArgEnvelope = {
	[ARG_ENVELOPE_TAG]: "callback"
	id: string
}

type ArgEnvelope = ValueArgEnvelope | CallbackArgEnvelope

type StreamRefEnvelope = {
	[STREAM_REF_TAG]: "async-iterable"
	id: string
}

type LocalStreamState = {
	iterator: AsyncIterator<unknown>
	credit: number
	pumping: boolean
	closed: boolean
}

type RemoteStreamState = {
	buffer: IteratorResult<unknown>[]
	consumedSincePull: number
	done: boolean
	error?: Error
	started: boolean
	waiters: Array<{
		resolve(result: IteratorResult<unknown>): void
		reject(error: Error): void
	}>
}

function isArgEnvelope(value: unknown): value is ArgEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		ARG_ENVELOPE_TAG in value &&
		((value as { [ARG_ENVELOPE_TAG]: unknown })[ARG_ENVELOPE_TAG] === "value" ||
			(value as { [ARG_ENVELOPE_TAG]: unknown })[ARG_ENVELOPE_TAG] === "callback")
	)
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
	)
}

function isStreamRefEnvelope(value: unknown): value is StreamRefEnvelope {
	if (typeof value !== "object" || value === null) return false
	const envelope = value as Partial<StreamRefEnvelope>
	return envelope[STREAM_REF_TAG] === "async-iterable" && typeof envelope.id === "string"
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
function isRPCStreamRequestMessage(value: unknown): value is RPCStreamRequest {
	if (typeof value !== "object" || value === null) return false
	const message = value as Partial<RPCStreamRequest>
	return (
		message.t === "sq" &&
		typeof message.id === "string" &&
		typeof message.sid === "string" &&
		typeof message.op === "string" &&
		RPC_STREAM_OPERATIONS.has(message.op as RPCStreamOperation)
	)
}

// Transports may share non-kkrpc frames; malformed frames are ignored by these guards.
function isRPCStreamResponseMessage(value: unknown): value is RPCStreamResponse {
	if (typeof value !== "object" || value === null) return false
	const message = value as Partial<RPCStreamResponse>
	return message.t === "sr" && typeof message.id === "string" && typeof message.sid === "string"
}

function generateId(): string {
	return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

function toRPCError(error: unknown): RPCError {
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

function fromRPCError(error: RPCError): Error {
	const result = new Error(error.m)
	result.name = error.n
	if (error.s) result.stack = error.s
	for (const key in error) {
		if (key === "n" || key === "m" || key === "s") continue
		Object.assign(result, { [key]: error[key] })
	}
	return result
}

function getPath(root: unknown, path: string[]): unknown {
	let current = root
	for (const segment of path) {
		if (current === null || current === undefined) {
			throw new Error(`Cannot access ${segment} on ${String(current)}`)
		}
		current = Reflect.get(Object(current), segment)
	}
	return current
}

function getParent(root: unknown, path: string[]): { parent: object; key: string } {
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
	/** Callback functions retained for remote callback invocations. */
	private callbacks = new Map<string, (...args: unknown[]) => unknown>()
	/** Whether this channel has been destroyed. */
	private destroyed = false
	private localStreams = new Map<string, LocalStreamState>()
	/** Pending outbound requests awaiting responses. */
	private pending = new Map<string, PendingRequest>()
	private pendingStreams = new Map<string, PendingRequest>()
	private remoteStreams = new Map<string, RemoteStreamState>()
	/** Whether this channel may forward transferable objects. */
	private supportsTransfer: boolean
	/** Transport subscription cleanup function. */
	private unsubscribe: () => void
	/** Request timeout in milliseconds. */
	private timeout: number
	/** Optional local API exposed to the remote endpoint. */
	private expose?: LocalAPI
	/** Plugin hooks used while processing requests and responses. */
	private plugins: readonly RPCPlugin[]
	/** Optional metadata provider for outbound requests. */
	private getMetadata?: () => RPCMessageMetadata | undefined

	/**
	 * Create a channel over one transport.
	 *
	 * The constructor subscribes immediately so incoming messages can be handled as
	 * soon as the transport starts delivering them.
	 */
	constructor(
		private transport: Transport<RPCMessage>,
		options: RPCChannelOptions<LocalAPI> = {}
	) {
		this.expose = options.expose
		this.plugins = options.plugins ?? []
		this.getMetadata = options.getMetadata
		this.supportsTransfer = options.enableTransfer !== false && transport.capabilities?.transfer === true
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
		for (const pending of this.pendingStreams.values()) {
			if (pending.timer) clearTimeout(pending.timer)
			pending.reject(new Error("RPC channel destroyed"))
		}
		this.pendingStreams.clear()
		this.callbacks.clear()
		for (const stream of this.localStreams.values()) {
			stream.closed = true
			void stream.iterator.return?.()
		}
		this.localStreams.clear()
		for (const stream of this.remoteStreams.values()) {
			stream.done = true
			const error = new Error("RPC channel destroyed")
			for (const waiter of stream.waiters) waiter.reject(error)
			stream.waiters.length = 0
		}
		this.remoteStreams.clear()
		this.transport.close?.()
	}

	/** Create a remote proxy rooted at a protocol path. */
	private createProxy(path: string[]): unknown {
		const target = function () {}
		return new Proxy(target, {
			get: (target, property, receiver) => {
				if (property === "then") {
					if (path.length === 0) return undefined
					const promise = this.request("get", path)
					return promise.then.bind(promise)
				}
				if (property === Symbol.asyncIterator && path.length > 0) {
					return () => this.createAsyncIteratorFromPromise(this.request("get", path))
				}
				if (typeof property === "symbol") return Reflect.get(target, property, receiver)
				return this.createProxy([...path, property])
			},
			set: (_target, property, value) => {
				if (typeof property === "symbol") return false
				void this.request("set", [...path, property], undefined, value).catch(() => {})
				return true
			},
			apply: (_target, _thisArg, args) =>
				this.withAsyncIterator(this.request("call", path, Array.from(args))),
			construct: (_target, args) => this.request("new", path, Array.from(args))
		})
	}

	// Register the pending response before sending to avoid races with synchronous transports.
	/** Send one RPC request and return the pending response promise. */
	private request(op: RPCOperation, path: string[], args?: unknown[], value?: unknown): Promise<unknown> {
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

	/** Grant the remote producer permission to send up to `credit` more chunks. */
	private sendStreamPull(streamId: string, credit: number): void {
		if (this.destroyed || credit <= 0) return
		this.post(
			{ t: "sq", id: generateId(), sid: streamId, op: "pull", n: credit },
			[],
			undefined,
			(error) => this.rejectRemoteStream(streamId, error)
		)
	}

	/** Send a closing async iterator control and wait for its acknowledgement. */
	private requestStreamControl(
		streamId: string,
		op: Exclude<RPCStreamOperation, "pull">,
		value?: unknown
	): Promise<IteratorResult<unknown>> {
		if (this.destroyed) return Promise.reject(new Error("RPC channel destroyed"))
		const id = generateId()
		const transfers: Transferable[] = []
		const message: RPCStreamRequest = { t: "sq", id, sid: streamId, op }
		if (arguments.length >= 3) message.v = this.encodeValue(value, transfers)

		const promise = new Promise<IteratorResult<unknown>>((resolve, reject) => {
			const pending: PendingRequest = {
				resolve: (result) => resolve(result as IteratorResult<unknown>),
				reject
			}
			if (this.timeout > 0) {
				pending.timer = setTimeout(() => {
					this.pendingStreams.delete(id)
					const error = new Error(`RPC stream request ${id} timed out after ${this.timeout}ms`)
					error.name = "RPCTimeoutError"
					reject(error)
				}, this.timeout)
			}
			this.pendingStreams.set(id, pending)
		})

		this.post(message, transfers, id)
		return promise
	}

	// If a transport write fails, reject the matching pending request instead of waiting for timeout.
	/** Send one protocol message and reject the pending request on write failure. */
	private post(
		message: RPCMessage,
		transfers: Transferable[] = [],
		pendingId?: string,
		onWriteError?: (error: Error) => void
	): void {
		try {
			const result = this.transport.send(message, transfers)
			if (result instanceof Promise) {
				void result.catch((error) => this.handleWriteFailure(pendingId, error, onWriteError))
			}
		} catch (error) {
			this.handleWriteFailure(pendingId, error, onWriteError)
		}
	}

	/** Dispatch transport write failures to request waiters or stream consumers. */
	private handleWriteFailure(
		pendingId: string | undefined,
		error: unknown,
		onWriteError?: (error: Error) => void
	): void {
		const normalized = error instanceof Error ? error : new Error(String(error))
		onWriteError?.(normalized)
		this.rejectPendingWrite(pendingId, normalized)
	}

	/** Reject a pending request when its transport write fails. */
	private rejectPendingWrite(pendingId: string | undefined, error: unknown): void {
		if (!pendingId) return
		const pending = this.pending.get(pendingId) ?? this.pendingStreams.get(pendingId)
		if (!pending) return
		this.pending.delete(pendingId)
		this.pendingStreams.delete(pendingId)
		if (pending.timer) clearTimeout(pending.timer)
		pending.reject(error instanceof Error ? error : new Error(String(error)))
	}

	/** Mark a remote async iterable as failed and reject all pending readers. */
	private rejectRemoteStream(streamId: string, error: Error): void {
		const stream = this.remoteStreams.get(streamId)
		if (!stream) return
		stream.error = error
		stream.done = true
		this.remoteStreams.delete(streamId)
		for (const waiter of stream.waiters.splice(0)) waiter.reject(error)
	}

	/** Dispatch one incoming protocol message by message kind. */
	private async handleMessage(message: RPCMessage): Promise<void> {
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
		if (isRPCStreamResponseMessage(message)) {
			this.handleStreamResponse(message)
			return
		}
		if (isRPCStreamRequestMessage(message)) {
			await this.handleStreamRequest(message)
			return
		}
		if (isRPCRequestMessage(message)) await this.handleRequest(message)
	}

	/** Resolve or reject the pending request associated with a response. */
	private handleResponse(id: string, value: unknown, error?: RPCError): void {
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

	/** Route stream data messages and resolve closing acknowledgements. */
	private handleStreamResponse(message: RPCStreamResponse): void {
		const pending = this.pendingStreams.get(message.id)
		if (pending) {
			this.pendingStreams.delete(message.id)
			if (pending.timer) clearTimeout(pending.timer)
			if (message.e) {
				pending.reject(fromRPCError(message.e))
				return
			}
			pending.resolve({ done: message.d === true, value: this.decodeValue(message.v) })
			return
		}

		const stream = this.remoteStreams.get(message.sid)
		if (!stream) return

		if (message.e) {
			const error = fromRPCError(message.e)
			stream.error = error
			stream.done = true
			this.remoteStreams.delete(message.sid)
			for (const waiter of stream.waiters.splice(0)) waiter.reject(error)
			return
		}

		const result: IteratorResult<unknown> = {
			done: message.d === true,
			value: this.decodeValue(message.v)
		}
		const waiter = stream.waiters.shift()
		if (waiter) {
			waiter.resolve(result)
			if (!result.done) this.afterRemoteStreamValueDelivered(message.sid, stream)
			if (result.done) {
				stream.done = true
				this.remoteStreams.delete(message.sid)
				for (const remaining of stream.waiters.splice(0)) remaining.resolve(result)
			}
			return
		}

		stream.buffer.push(result)
		if (result.done) {
			stream.done = true
			this.remoteStreams.delete(message.sid)
		}
	}

	/** Execute an incoming request and post a protocol response. */
	private async handleRequest(message: RPCRequest): Promise<void> {
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

	/** Apply incoming stream credit or closing controls to a local async iterator. */
	private async handleStreamRequest(message: RPCStreamRequest): Promise<void> {
		const stream = this.localStreams.get(message.sid)
		if (!stream) {
			if (message.op === "return") {
				this.post({ t: "sr", id: message.id, sid: message.sid, d: true, v: this.decodeValue(message.v) })
				return
			}
			this.post({
				t: "sr",
				id: message.id,
				sid: message.sid,
				e: toRPCError(new Error(`Unknown RPC stream ${message.sid}`))
			})
			return
		}

		try {
			if (message.op === "pull") {
				stream.credit += this.normalizeStreamCredit(message.n)
				void this.pumpLocalStream(message.sid, stream)
				return
			}

			const transfers: Transferable[] = []
			const value = this.decodeValue(message.v)
			if (message.op === "return") {
				stream.closed = true
				this.localStreams.delete(message.sid)
				const result = stream.iterator.return ? await stream.iterator.return(value) : { done: true, value }
				this.post({
					t: "sr",
					id: message.id,
					sid: message.sid,
					d: result.done === true,
					v: this.encodeValue(result.value, transfers)
				}, transfers)
				return
			}

			let result: IteratorResult<unknown>
			if (stream.iterator.throw) {
				result = await stream.iterator.throw(value)
			} else {
				throw value instanceof Error ? value : new Error(String(value))
			}
			if (result.done) {
				stream.closed = true
				this.localStreams.delete(message.sid)
			}
			this.post({
				t: "sr",
				id: message.id,
				sid: message.sid,
				d: result.done === true,
				v: this.encodeValue(result.value, transfers)
			}, transfers)
		} catch (error) {
			stream.closed = true
			this.localStreams.delete(message.sid)
			this.post({ t: "sr", id: message.id, sid: message.sid, e: toRPCError(error) })
		}
	}

	/** Clamp remote stream credit to a positive finite integer. */
	private normalizeStreamCredit(credit: number | undefined): number {
		if (typeof credit !== "number" || !Number.isFinite(credit)) return 1
		return Math.max(1, Math.floor(credit))
	}

	/** Pump yielded values while the remote consumer has outstanding credit. */
	private async pumpLocalStream(streamId: string, stream: LocalStreamState): Promise<void> {
		if (stream.pumping || stream.closed) return
		stream.pumping = true
		try {
			while (!this.destroyed && !stream.closed && stream.credit > 0) {
				stream.credit--
				const result = await stream.iterator.next()
				if (this.destroyed || stream.closed) return

				const transfers: Transferable[] = []
				if (result.done) {
					stream.closed = true
					this.localStreams.delete(streamId)
					this.post({
						t: "sr",
						id: generateId(),
						sid: streamId,
						d: true,
						v: this.encodeValue(result.value, transfers)
					}, transfers)
					return
				}

				this.post({
					t: "sr",
					id: generateId(),
					sid: streamId,
					d: false,
					v: this.encodeValue(result.value, transfers)
				}, transfers)
			}
		} catch (error) {
			stream.closed = true
			this.localStreams.delete(streamId)
			this.post({ t: "sr", id: generateId(), sid: streamId, e: toRPCError(error) })
		} finally {
			stream.pumping = false
			if (!this.destroyed && !stream.closed && stream.credit > 0) {
				void this.pumpLocalStream(streamId, stream)
			}
		}
	}

	/** Run plugin hooks and invoke the local API for one incoming request. */
	private async executeRequest(message: RPCRequest): Promise<unknown> {
		if (!this.expose) throw new Error("No API exposed")
		const state: Record<string, unknown> = {}
		const decodedStreams: AsyncIterable<unknown>[] = []
		const requestCtx = {
			id: message.id,
			operation: message.op,
			path: message.p,
			method: message.p.join("."),
			args: this.decodeArgs(message.a ?? [], decodedStreams),
			value: this.decodeValue(message.v, decodedStreams),
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
			let caught = error
			const errorCtx = {
				id: message.id,
				operation: message.op,
				path: message.p,
				method: message.p.join("."),
				error: caught,
				meta: message.meta,
				state
			}
			try {
				await runErrorHooks(this.plugins, errorCtx)
				caught = errorCtx.error
			} finally {
				this.closeDecodedRemoteStreams(decodedStreams)
			}
			throw caught
		}
	}

	/** Invoke the exposed local API according to one compact RPC operation. */
	private async invokeRequest(ctx: {
		operation: RPCOperation
		path: string[]
		args: unknown[]
		value?: unknown
	}): Promise<unknown> {
		if (!this.expose) throw new Error("No API exposed")
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

	/** Add async iterator ergonomics to a remote call promise without changing await behavior. */
	private withAsyncIterator(promise: Promise<unknown>): Promise<unknown> & AsyncIterable<unknown> {
		const iterablePromise = promise as Promise<unknown> & AsyncIterable<unknown>
		Object.defineProperty(iterablePromise, Symbol.asyncIterator, {
			configurable: true,
			value: () => this.createAsyncIteratorFromPromise(promise)
		})
		return iterablePromise
	}

	/** Create an async iterator that waits for a remote call or getter to resolve to an iterable. */
	private createAsyncIteratorFromPromise(promise: Promise<unknown>): AsyncIterator<unknown> {
		let iteratorPromise: Promise<AsyncIterator<unknown>> | undefined
		const getIterator = async () => {
			iteratorPromise ??= promise.then((value) => {
				if (!isAsyncIterable(value)) {
					throw new TypeError("RPC result is not async iterable")
				}
				return value[Symbol.asyncIterator]()
			})
			return await iteratorPromise
		}

		return {
			next: async (value?: unknown) => {
				const iterator = await getIterator()
				return await iterator.next(value)
			},
			return: async (value?: unknown) => {
				const iterator = await getIterator()
				if (iterator.return) return await iterator.return(value)
				return { done: true, value }
			},
			throw: async (error?: unknown) => {
				const iterator = await getIterator()
				if (iterator.throw) return await iterator.throw(error)
				throw error instanceof Error ? error : new Error(String(error))
			}
		}
	}

	/** Replenish stream credit after the consumer drains enough delivered values. */
	private afterRemoteStreamValueDelivered(streamId: string, stream: RemoteStreamState): void {
		if (stream.done) return
		stream.consumedSincePull++
		if (stream.consumedSincePull < STREAM_CREDIT_REPLENISH) return
		this.sendStreamPull(streamId, stream.consumedSincePull)
		stream.consumedSincePull = 0
	}

	/** Create a single-consumer async iterable backed by remote stream protocol messages. */
	private createRemoteAsyncIterable(streamId: string): AsyncIterable<unknown> {
		const stream: RemoteStreamState = {
			buffer: [],
			consumedSincePull: 0,
			done: false,
			started: false,
			waiters: []
		}
		this.remoteStreams.set(streamId, stream)

		const readBuffered = (): IteratorResult<unknown> | undefined => {
			const result = stream.buffer.shift()
			if (!result) return undefined
			if (result.done) {
				stream.done = true
				this.remoteStreams.delete(streamId)
			} else {
				this.afterRemoteStreamValueDelivered(streamId, stream)
			}
			return result
		}

		const start = () => {
			if (stream.started || stream.done) return
			stream.started = true
			this.sendStreamPull(streamId, STREAM_CREDIT_WINDOW)
		}

		const iterator: AsyncIterator<unknown> = {
			next: async () => {
				const buffered = readBuffered()
				if (buffered) return buffered
				if (stream.error) throw stream.error
				if (stream.done) return { done: true, value: undefined }
				return await new Promise<IteratorResult<unknown>>((resolve, reject) => {
					stream.waiters.push({ resolve, reject })
					start()
				})
			},
			return: async (value?: unknown) => {
				if (stream.done) return { done: true, value }
				stream.done = true
				this.remoteStreams.delete(streamId)
				for (const waiter of stream.waiters.splice(0)) waiter.resolve({ done: true, value })
				return await this.requestStreamControl(streamId, "return", value)
			},
			throw: async (error?: unknown) => {
				if (stream.done) throw error instanceof Error ? error : new Error(String(error))
				stream.done = true
				this.remoteStreams.delete(streamId)
				const thrown = error instanceof Error ? error : new Error(String(error))
				for (const waiter of stream.waiters.splice(0)) waiter.reject(thrown)
				return await this.requestStreamControl(streamId, "throw", error)
			}
		}
		return {
			[Symbol.asyncIterator]() {
				return iterator
			}
		}
	}

	/** Close remote stream arguments created while decoding a failed request. */
	private closeDecodedRemoteStreams(streams: AsyncIterable<unknown>[]): void {
		for (const stream of streams) {
			try {
				const result = stream[Symbol.asyncIterator]().return?.()
				if (result) void Promise.resolve(result).catch(() => {})
			} catch {
				// Preserve the original request error; cleanup is best-effort once failure handling starts.
			}
		}
	}

	// Function arguments become callback records that can be invoked later by callback id.
	/** Encode call arguments into value and callback envelopes. */
	private encodeArgs(args: unknown[], transfers: Transferable[]): unknown[] {
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
	private decodeArgs(args: unknown[], decodedStreams?: AsyncIterable<unknown>[]): unknown[] {
		return args.map((arg) => {
			if (!isArgEnvelope(arg)) return arg
			if (arg[ARG_ENVELOPE_TAG] === "value") return this.decodeValue(arg.v, decodedStreams)
			if (arg[ARG_ENVELOPE_TAG] === "callback") {
				const id = arg.id
				return (...callbackArgs: unknown[]) => {
					const transfers: Transferable[] = []
					this.post({ t: "cb", id, a: this.encodeArgs(callbackArgs, transfers) }, transfers)
				}
			}
		})
	}

	// Transfer descriptors are consumed only when this channel and transport advertise transfer support.
	/** Encode a value and collect transferables when the transport supports them. */
	private encodeValue(value: unknown, transfers: Transferable[]): unknown {
		const descriptor = this.supportsTransfer ? takeTransferDescriptor(value) : undefined
		if (descriptor) {
			transfers.push(...descriptor.transfers)
			return descriptor.value
		}
		if (isAsyncIterable(value)) {
			const id = generateId()
			this.localStreams.set(id, {
				iterator: value[Symbol.asyncIterator](),
				credit: 0,
				pumping: false,
				closed: false
			})
			return { [STREAM_REF_TAG]: "async-iterable", id } satisfies StreamRefEnvelope
		}
		return value
	}

	/** Decode a value envelope that may reference a remote async iterable. */
	private decodeValue(value: unknown, decodedStreams?: AsyncIterable<unknown>[]): unknown {
		if (isStreamRefEnvelope(value)) {
			const iterable = this.createRemoteAsyncIterable(value.id)
			decodedStreams?.push(iterable)
			return iterable
		}
		return value
	}
}
