/**
 * Opt-in async-iterable streaming RPC channel.
 *
 * The default `RPCChannel` intentionally excludes this state machine so simple
 * browser bundles stay small. `StreamingRPCChannel` adds stream reference
 * encoding, pull-credit flow control, stream request/response dispatch, and
 * cleanup for async iterables passed across bidirectional transports.
 * @module
 */

import { fromRPCError, RPCChannel, type RPCChannelOptions } from "./channel.ts"
import { runErrorHooks, runHandlerHooks, runRequestHooks, runResponseHooks } from "./plugins.ts"
import type {
	RPCMessage,
	RPCRequest,
	RPCStreamOperation,
	RPCStreamRequest,
	RPCStreamResponse
} from "./protocol.ts"
import type { Transport } from "./transport.ts"

// Keep enough values in flight to avoid a round trip per chunk while bounding buffering.
const STREAM_CREDIT_WINDOW = 32
const STREAM_CREDIT_REPLENISH = 16
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

type PendingRequest = {
	resolve(value: unknown): void
	reject(error: Error): void
	timer?: ReturnType<typeof setTimeout>
}

function generateId(): string {
	return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

/** Return whether a value can be consumed with `for await`. */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
	)
}

/** Type guard for stream handles embedded in normal RPC values. */
function isStreamRefEnvelope(value: unknown): value is StreamRefEnvelope {
	if (typeof value !== "object" || value === null) return false
	const envelope = value as Partial<StreamRefEnvelope>
	return envelope[STREAM_REF_TAG] === "async-iterable" && typeof envelope.id === "string"
}

/** Type guard for the default channel's callback/value argument envelope. */
function isArgEnvelope(value: unknown): value is ArgEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		ARG_ENVELOPE_TAG in value &&
		((value as { [ARG_ENVELOPE_TAG]: unknown })[ARG_ENVELOPE_TAG] === "value" ||
			(value as { [ARG_ENVELOPE_TAG]: unknown })[ARG_ENVELOPE_TAG] === "callback")
	)
}

/** Type guard for stream control messages sent by a remote consumer. */
function isRPCStreamRequestMessage(value: RPCMessage): value is RPCStreamRequest {
	if (typeof value !== "object" || value === null) return false
	const message = value as Partial<RPCStreamRequest>
	return (
		message.t === "sq" &&
		typeof message.id === "string" &&
		typeof message.sid === "string" &&
		typeof message.op === "string" &&
		(message.op === "pull" || message.op === "return" || message.op === "throw")
	)
}

/** Type guard for stream data/completion/error messages sent by a producer. */
function isRPCStreamResponseMessage(value: RPCMessage): value is RPCStreamResponse {
	if (typeof value !== "object" || value === null) return false
	const message = value as Partial<RPCStreamResponse>
	return message.t === "sr" && typeof message.id === "string" && typeof message.sid === "string"
}

/**
 * RPC channel variant with async iterable streaming enabled.
 *
 * Use this through `kkrpc/streaming` when methods need to return or accept
 * `AsyncIterable` values. For ordinary request/response RPC, prefer the default
 * `RPCChannel` to avoid paying for stream state in the bundle.
 */
export class StreamingRPCChannel<
	LocalAPI extends object = object,
	RemoteAPI extends object = object
> extends RPCChannel<LocalAPI, RemoteAPI> {
	private localStreams = new Map<string, LocalStreamState>()
	private pendingStreams = new Map<string, PendingRequest>()
	private remoteStreams = new Map<string, RemoteStreamState>()

	constructor(transport: Transport<RPCMessage>, options: RPCChannelOptions<LocalAPI> = {}) {
		super(transport, options)
	}

	/** Close pending stream operations and notify local iterators during teardown. */
	override destroy(): void {
		if (this.destroyed) return
		for (const pending of this.pendingStreams.values()) {
			if (pending.timer) clearTimeout(pending.timer)
			pending.reject(new Error("RPC channel destroyed"))
		}
		this.pendingStreams.clear()
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
		super.destroy()
	}

	/** Add `[Symbol.asyncIterator]` support to remote proxies for stream results. */
	protected override createProxy(path: string[]): unknown {
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

	/** Route stream protocol messages before falling back to the base channel. */
	protected override async handleMessage(message: RPCMessage): Promise<void> {
		if (this.destroyed) return
		if (isRPCStreamResponseMessage(message)) {
			this.handleStreamResponse(message)
			return
		}
		if (isRPCStreamRequestMessage(message)) {
			await this.handleStreamRequest(message)
			return
		}
		await super.handleMessage(message)
	}

	/** Reject either normal pending calls or pending stream-control calls after send failure. */
	protected override rejectPendingWrite(pendingId: string | undefined, error: unknown): void {
		if (!pendingId) return
		const pending = this.pending.get(pendingId) ?? this.pendingStreams.get(pendingId)
		if (!pending) return
		this.pending.delete(pendingId)
		this.pendingStreams.delete(pendingId)
		if (pending.timer) clearTimeout(pending.timer)
		pending.reject(error instanceof Error ? error : new Error(String(error)))
	}

	/** Decode stream arguments and ensure decoded remote streams are closed on early failure. */
	protected override async executeRequest(message: RPCRequest): Promise<unknown> {
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
				await this.closeDecodedRemoteStreams(decodedStreams)
			}
			throw caught
		}
	}

	/** Decode callback/value envelopes without losing track of stream refs for cleanup. */
	protected override decodeArgs(
		args: unknown[],
		decodedStreams?: AsyncIterable<unknown>[]
	): unknown[] {
		return args.map((arg) => {
			if (!isArgEnvelope(arg)) return this.decodeValue(arg, decodedStreams)
			if (arg[ARG_ENVELOPE_TAG] === "value") return this.decodeValue(arg.v, decodedStreams)
			const id = arg.id
			return (...callbackArgs: unknown[]) => {
				const transfers: Transferable[] = []
				this.post({ t: "cb", id, a: this.encodeArgs(callbackArgs, transfers) }, transfers)
			}
		})
	}

	/** Replace async iterables with stream reference envelopes before sending. */
	protected override encodeValue(value: unknown, transfers: Transferable[]): unknown {
		const encodedByBase = super.encodeValue(value, transfers)
		if (encodedByBase !== value) return encodedByBase
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

	/** Turn received stream reference envelopes into local async iterables. */
	protected override decodeValue(
		value: unknown,
		decodedStreams?: AsyncIterable<unknown>[]
	): unknown {
		if (isStreamRefEnvelope(value)) {
			const iterable = this.createRemoteAsyncIterable(value.id)
			decodedStreams?.push(iterable)
			return iterable
		}
		return super.decodeValue(value)
	}

	/** Ask the producer for more stream items. Pulls are intentionally one-way. */
	private sendStreamPull(streamId: string, credit: number): void {
		if (this.destroyed || credit <= 0) return
		this.post(
			{ t: "sq", id: generateId(), sid: streamId, op: "pull", n: credit },
			[],
			undefined,
			(error) => this.rejectRemoteStream(streamId, error)
		)
	}

	/** Send `return` or `throw` to the producer and wait for its iterator result. */
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

	/** Fail a remote consumer when a stream control message cannot be written. */
	private rejectRemoteStream(streamId: string, error: Error): void {
		const stream = this.remoteStreams.get(streamId)
		if (!stream) return
		stream.error = error
		stream.done = true
		this.remoteStreams.delete(streamId)
		for (const waiter of stream.waiters.splice(0)) waiter.reject(error)
	}

	/** Release a producer-side iterator when its stream response cannot be delivered. */
	private closeLocalStreamAfterWriteFailure(streamId: string, stream: LocalStreamState): void {
		if (stream.closed) return
		stream.closed = true
		this.localStreams.delete(streamId)
		void stream.iterator.return?.()
	}

	/** Deliver stream responses to pending control calls or buffered async iterators. */
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

	/** Apply pull/return/throw operations to a local iterator owned by this channel. */
	private async handleStreamRequest(message: RPCStreamRequest): Promise<void> {
		const stream = this.localStreams.get(message.sid)
		if (!stream) {
			if (message.op === "return") {
				this.post({
					t: "sr",
					id: message.id,
					sid: message.sid,
					d: true,
					v: this.decodeValue(message.v)
				})
				return
			}
			this.post({
				t: "sr",
				id: message.id,
				sid: message.sid,
				e: { n: "Error", m: `Unknown RPC stream ${message.sid}` }
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
				const result = stream.iterator.return
					? await stream.iterator.return(value)
					: { done: true, value }
				this.post(
					{
						t: "sr",
						id: message.id,
						sid: message.sid,
						d: result.done === true,
						v: this.encodeValue(result.value, transfers)
					},
					transfers
				)
				return
			}

			let result: IteratorResult<unknown>
			if (stream.iterator.throw) result = await stream.iterator.throw(value)
			else throw value instanceof Error ? value : new Error(String(value))
			if (result.done) {
				stream.closed = true
				this.localStreams.delete(message.sid)
			}
			this.post(
				{
					t: "sr",
					id: message.id,
					sid: message.sid,
					d: result.done === true,
					v: this.encodeValue(result.value, transfers)
				},
				transfers
			)
		} catch (error) {
			stream.closed = true
			this.localStreams.delete(message.sid)
			this.post({ t: "sr", id: message.id, sid: message.sid, e: { n: "Error", m: String(error) } })
		}
	}

	/** Normalize untrusted credit values from the wire to a positive integer. */
	private normalizeStreamCredit(credit: number | undefined): number {
		if (typeof credit !== "number" || !Number.isFinite(credit)) return 1
		return Math.max(1, Math.floor(credit))
	}

	/** Pump local iterator values while the remote consumer has outstanding credit. */
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
					this.post(
						{
							t: "sr",
							id: generateId(),
							sid: streamId,
							d: true,
							v: this.encodeValue(result.value, transfers)
						},
						transfers
					)
					return
				}

				let writeFailed = false
				await this.post(
					{
						t: "sr",
						id: generateId(),
						sid: streamId,
						d: false,
						v: this.encodeValue(result.value, transfers)
					},
					transfers,
					undefined,
					() => {
						writeFailed = true
						this.closeLocalStreamAfterWriteFailure(streamId, stream)
					}
				)
				if (writeFailed) return
			}
		} catch (error) {
			stream.closed = true
			this.localStreams.delete(streamId)
			this.post({ t: "sr", id: generateId(), sid: streamId, e: { n: "Error", m: String(error) } })
		} finally {
			stream.pumping = false
			if (!this.destroyed && !stream.closed && stream.credit > 0) {
				void this.pumpLocalStream(streamId, stream)
			}
		}
	}

	/** Let a promise-returning remote method also be consumed directly with `for await`. */
	private withAsyncIterator(promise: Promise<unknown>): Promise<unknown> & AsyncIterable<unknown> {
		const iterablePromise = promise as Promise<unknown> & AsyncIterable<unknown>
		Object.defineProperty(iterablePromise, Symbol.asyncIterator, {
			configurable: true,
			value: () => this.createAsyncIteratorFromPromise(promise)
		})
		return iterablePromise
	}

	/** Lazily resolve the initial RPC result and forward iterator operations to it. */
	private createAsyncIteratorFromPromise(promise: Promise<unknown>): AsyncIterator<unknown> {
		let iteratorPromise: Promise<AsyncIterator<unknown>> | undefined
		const getIterator = async () => {
			iteratorPromise ??= promise.then((value) => {
				if (!isAsyncIterable(value)) throw new TypeError("RPC result is not async iterable")
				return value[Symbol.asyncIterator]()
			})
			return await iteratorPromise
		}
		return {
			next: async (value?: unknown) => await (await getIterator()).next(value),
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

	/** Replenish producer credit after the consumer drains enough values. */
	private afterRemoteStreamValueDelivered(streamId: string, stream: RemoteStreamState): void {
		if (stream.done) return
		stream.consumedSincePull++
		if (stream.consumedSincePull < STREAM_CREDIT_REPLENISH) return
		this.sendStreamPull(streamId, stream.consumedSincePull)
		stream.consumedSincePull = 0
	}

	/** Create the local async iterable facade for a remote stream reference. */
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
			} else this.afterRemoteStreamValueDelivered(streamId, stream)
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
		return { [Symbol.asyncIterator]: () => iterator }
	}

	/** Close stream arguments that were decoded for a request that failed early. */
	private async closeDecodedRemoteStreams(streams: AsyncIterable<unknown>[]): Promise<void> {
		for (const stream of streams) {
			try {
				const result = stream[Symbol.asyncIterator]().return?.()
				if (result) await result
			} catch {
				// Preserve the original request error; cleanup is best-effort once failure handling starts.
			}
		}
	}
}
