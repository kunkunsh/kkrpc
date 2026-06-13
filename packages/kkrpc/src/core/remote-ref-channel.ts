/**
 * Opt-in remote-reference RPC channel.
 *
 * This channel powers `kkrpc/remote-refs`. It keeps the default `RPCChannel`
 * small while providing Comlink-style explicit `proxy(value)` references,
 * request/response callback return values, object proxy get/set/call support,
 * pass-back identity, and deterministic `releaseProxy()` cleanup.
 * @module
 */

import {
	RPCChannel,
	fromRPCError,
	getParent,
	getPath,
	toRPCError,
	type RPCChannelOptions
} from "./channel.ts"
import type { RPCError, RPCMessage, RPCMessageMetadata, RPCRequest } from "./protocol.ts"
import {
	getRemoteProxyRecord,
	isExplicitProxyTarget,
	isRemoteRefEnvelope,
	registerRemoteProxy,
	REMOTE_REF_TAG,
	RPCEncodeError,
	RPCRemoteReferenceReleasedError,
	type RemoteProxyRecord,
	type RemoteRefEnvelope,
	type RemoteRefKind
} from "./remote-ref.ts"
import type { Transport } from "./transport.ts"

/** Options for `RemoteReferenceRPCChannel`. */
export interface RemoteReferenceRPCChannelOptions<LocalAPI extends object = object>
	extends RPCChannelOptions<LocalAPI> {
	/** Disable remote references even when using the remote-ref entry. */
	remoteRefs?: boolean
}

type PendingRequest = {
	resolve(value: unknown): void
	reject(error: Error): void
	timer?: ReturnType<typeof setTimeout>
}

type RewriteState = {
	changed: boolean
	cycleDetected: boolean
	newRefs: Array<{ id: string; value?: object; receiver?: object }>
	seen: WeakSet<object>
}

type LocalRefRecord = {
	kind: RemoteRefKind
	value?: unknown
	receiver?: unknown
	released: boolean
}

const MAX_RELEASED_LOCAL_REF_IDS = 1024

function generateId(): string {
	return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

/** Restrict recursive marker traversal to ordinary data containers. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false
	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

/** Type guard for internal remote-reference operation requests. */
function isRPCRefRequestMessage(value: RPCMessage): value is RPCRequest {
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

/**
 * RPC channel variant with explicit Comlink-style remote references enabled.
 *
 * Use this through `kkrpc/remote-refs` when functions or objects marked with
 * `proxy(value)` should remain owned by the sender and be called later through
 * request/response RPC operations.
 */
export class RemoteReferenceRPCChannel<
	LocalAPI extends object = object,
	RemoteAPI extends object = object
> extends RPCChannel<LocalAPI, RemoteAPI> {
	private localRefIds = new WeakMap<object, string>()
	private localReceiverRefIds = new WeakMap<object, WeakMap<object, string>>()
	private localRefs = new Map<string, LocalRefRecord>()
	private releasedLocalRefIdOrder: string[] = []
	private releasedLocalRefIds = new Set<string>()
	private remoteProxyRecords = new Set<RemoteProxyRecord>()
	private supportsRemoteRefs: boolean

	constructor(
		transport: Transport<RPCMessage>,
		options: RemoteReferenceRPCChannelOptions<LocalAPI> = {}
	) {
		super(transport, options)
		this.supportsRemoteRefs =
			options.remoteRefs !== false && transport.capabilities?.remoteRefs === true
	}

	/** Release local bookkeeping and mark decoded remote proxies as unusable. */
	override destroy(): void {
		if (this.destroyed) return
		for (const record of this.remoteProxyRecords) record.markReleased()
		this.remoteProxyRecords.clear()
		this.localRefIds = new WeakMap()
		this.localReceiverRefIds = new WeakMap()
		this.localRefs.clear()
		this.releasedLocalRefIdOrder.length = 0
		this.releasedLocalRefIds.clear()
		super.destroy()
	}

	/** Route internal `op: "ref"` messages before normal exposed-API dispatch. */
	protected override async handleMessage(message: RPCMessage): Promise<void> {
		if (this.destroyed) return
		if (isRPCRefRequestMessage(message)) {
			await this.handleRequest(message)
			return
		}
		await super.handleMessage(message)
	}

	/** Encode ordinary and remote-reference responses through the same retention path. */
	protected override async handleRequest(message: RPCRequest): Promise<void> {
		try {
			const value =
				message.op === "ref"
					? await this.executeRefRequest(message)
					: await this.executeRequest(message)
			if (this.destroyed) return
			this.postResponseValue(message.id, value)
		} catch (error) {
			if (this.destroyed) return
			this.postResponseError(message.id, error)
		}
	}

	/** Decode remote-reference envelopes inside response values and custom error fields. */
	protected override handleResponse(id: string, value: unknown, error?: RPCError): void {
		const pending = this.pending.get(id)
		if (!pending) return
		this.pending.delete(id)
		if (pending.timer) clearTimeout(pending.timer)
		if (error) {
			pending.reject(this.decodeRPCError(error))
			return
		}
		pending.resolve(this.decodeRoot(value))
	}

	/** Encode outbound requests and roll back newly retained refs if the send fails. */
	protected override request(
		op: RPCRequest["op"],
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
		const retainedRefs = this.createRewriteState()
		try {
			if (args) message.a = this.encodeArgs(args, transfers, retainedRefs)
			if (arguments.length >= 4) message.v = this.encodeRoot(value, transfers, retainedRefs)
		} catch (error) {
			this.rollbackNewRefs(retainedRefs)
			return Promise.reject(error instanceof Error ? error : new Error(String(error)))
		}
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

		this.post(message, transfers, id, () => this.rollbackNewRefs(retainedRefs))
		return promise
	}

	/** Encode arguments with recursive explicit proxy marker support. */
	protected override encodeArgs(
		args: unknown[],
		transfers: Transferable[],
		state = this.createRewriteState()
	): unknown[] {
		try {
			const encoded = args.map((arg) => this.encodeValue(arg, transfers, state))
			this.assertNoCyclicRewrite(state)
			return encoded
		} catch (error) {
			this.rollbackNewRefs(state)
			throw error
		}
	}

	/** Decode arguments, replacing remote-reference envelopes with local proxy facades. */
	protected override decodeArgs(args: unknown[]): unknown[] {
		const state = this.createRewriteState()
		const decoded = args.map((arg) => this.decodeValue(arg, state))
		this.assertNoCyclicRewrite(state)
		return decoded
	}

	/** Encode one root value and reject cyclic graphs only if rewriting was required. */
	protected encodeRoot(
		value: unknown,
		transfers: Transferable[],
		state = this.createRewriteState()
	): unknown {
		try {
			const encoded = this.encodeValue(value, transfers, state)
			this.assertNoCyclicRewrite(state)
			return encoded
		} catch (error) {
			this.rollbackNewRefs(state)
			throw error
		}
	}

	/** Decode one root value and reject cyclic graphs only if rewriting was required. */
	protected decodeRoot(value: unknown): unknown {
		const state = this.createRewriteState()
		const decoded = this.decodeValue(value, state)
		this.assertNoCyclicRewrite(state)
		return decoded
	}

	/**
	 * Encode transfer descriptors, pass-back proxies, and explicit `proxy()` markers.
	 *
	 * Plain arrays/objects are shallow-copied only when a nested explicit marker or
	 * remote proxy is rewritten. Unmarked nested functions are intentionally left
	 * alone by this slim explicit entry.
	 */
	protected override encodeValue(
		value: unknown,
		transfers: Transferable[],
		state = this.createRewriteState(),
		receiver?: unknown
	): unknown {
		const encodedByBase = super.encodeValue(value, transfers)
		if (encodedByBase !== value) {
			state.changed = true
			return encodedByBase
		}
		const record = getRemoteProxyRecord(value)
		if (record) {
			state.changed = true
			return this.retainLocalRef(record.kind, value, state)
		}
		if (isExplicitProxyTarget(value)) {
			state.changed = true
			return this.retainLocalRef(typeof value === "function" ? "function" : "object", value, state, receiver)
		}
		if (Array.isArray(value)) {
			if (state.seen.has(value)) {
				state.cycleDetected = true
				return value
			}
			state.seen.add(value)
			let copy: unknown[] | undefined
			for (let index = 0; index < value.length; index++) {
				const encoded = this.encodeValue(value[index], transfers, state)
				if (copy) copy[index] = encoded
				else if (encoded !== value[index]) {
					copy = value.slice(0, index)
					copy[index] = encoded
				}
			}
			state.seen.delete(value)
			if (copy) state.changed = true
			return copy ?? value
		}
		if (isPlainObject(value) && !isRemoteRefEnvelope(value)) {
			if (state.seen.has(value)) {
				state.cycleDetected = true
				return value
			}
			state.seen.add(value)
			let copy: Record<string, unknown> | undefined
			for (const key of Object.keys(value)) {
				const current = value[key]
				const encoded = this.encodeValue(current, transfers, state, value)
				if (copy) copy[key] = encoded
				else if (encoded !== current) {
					copy = { ...value }
					copy[key] = encoded
				}
			}
			state.seen.delete(value)
			if (copy) state.changed = true
			return copy ?? value
		}
		return value
	}

	/** Decode remote-reference envelopes recursively inside plain arrays/objects. */
	protected override decodeValue(value: unknown, state = this.createRewriteState()): unknown {
		if (isRemoteRefEnvelope(value)) {
			state.changed = true
			const localRef = this.localRefs.get(value.id)
			if (localRef) {
				if (localRef.released) throw new RPCRemoteReferenceReleasedError(value.id)
				if (value.kind === "object" && value.p) return getPath(localRef.value, value.p)
				if (
					value.kind === "function" &&
					typeof localRef.value === "function" &&
					localRef.receiver !== undefined
				) {
					return (...args: unknown[]) => {
						if (localRef.released) throw new RPCRemoteReferenceReleasedError(value.id)
						if (typeof localRef.value !== "function") {
							throw new RPCRemoteReferenceReleasedError(value.id)
						}
						return Reflect.apply(localRef.value, localRef.receiver, args)
					}
				}
				return localRef.value
			}
			if (this.releasedLocalRefIds.has(value.id)) {
				throw new RPCRemoteReferenceReleasedError(value.id)
			}
			if (value.kind === "function") return this.createRemoteFunction(value)
			return this.createRemoteObject(value)
		}
		if (Array.isArray(value)) {
			if (state.seen.has(value)) {
				state.cycleDetected = true
				return value
			}
			state.seen.add(value)
			let copy: unknown[] | undefined
			for (let index = 0; index < value.length; index++) {
				const decoded = this.decodeValue(value[index], state)
				if (copy) copy[index] = decoded
				else if (decoded !== value[index]) {
					copy = value.slice(0, index)
					copy[index] = decoded
				}
			}
			state.seen.delete(value)
			if (copy) state.changed = true
			return copy ?? value
		}
		if (isPlainObject(value)) {
			if (state.seen.has(value)) {
				state.cycleDetected = true
				return value
			}
			state.seen.add(value)
			let copy: Record<string, unknown> | undefined
			for (const key of Object.keys(value)) {
				const current = value[key]
				const decoded = this.decodeValue(current, state)
				if (copy) copy[key] = decoded
				else if (decoded !== current) {
					copy = { ...value }
					copy[key] = decoded
				}
			}
			state.seen.delete(value)
			if (copy) state.changed = true
			return copy ?? value
		}
		return value
	}

	/** Track whether a recursive encode/decode pass actually rewrote by-reference values. */
	private createRewriteState(): RewriteState {
		return { changed: false, cycleDetected: false, newRefs: [], seen: new WeakSet() }
	}

	/** Reject cycles only when rewriting would have produced a partially cloned graph. */
	private assertNoCyclicRewrite(state: RewriteState): void {
		if (!state.changed || !state.cycleDetected) return
		throw new RPCEncodeError("Cannot perform cyclic remote-reference rewriting")
	}

	/** Send a successful response and retain any newly exported refs only if sending succeeds. */
	private postResponseValue(id: string, value: unknown): void {
		const transfers: Transferable[] = []
		const retainedRefs = this.createRewriteState()
		this.post(
			{ t: "r", id, v: this.encodeRoot(value, transfers, retainedRefs) },
			transfers,
			undefined,
			() => this.rollbackNewRefs(retainedRefs)
		)
	}

	/** Send an error response while preserving encodable custom error fields. */
	private postResponseError(id: string, error: unknown): void {
		const transfers: Transferable[] = []
		const retainedRefs = this.createRewriteState()
		this.post(
			{ t: "r", id, e: this.encodeRPCErrorOrFallback(error, transfers, retainedRefs) },
			transfers,
			undefined,
			() => this.rollbackNewRefs(retainedRefs)
		)
	}

	/** Encode custom error fields, falling back to a plain error if a field cannot be encoded. */
	private encodeRPCErrorOrFallback(
		error: unknown,
		transfers: Transferable[],
		state: RewriteState
	): RPCError {
		try {
			const result = toRPCError(error)
			if (!(error instanceof Error)) return result
			const record = error as Error & Record<string, unknown>
			for (const key in record) {
				if (key === "name" || key === "message" || key === "stack") continue
				result[key] = this.encodeValue(record[key], transfers, state)
			}
			this.assertNoCyclicRewrite(state)
			return result
		} catch (encodeError) {
			this.rollbackNewRefs(state)
			return { n: "Error", m: `${String(error)} (error custom field encoding failed: ${String(encodeError)})` }
		}
	}

	/** Decode custom error fields that may contain remote-reference envelopes. */
	private decodeRPCError(error: RPCError): Error {
		const result = fromRPCError(error)
		for (const key in error) {
			if (key === "n" || key === "m" || key === "s") continue
			Object.assign(result, { [key]: this.decodeRoot(error[key]) })
		}
		return result
	}

	/** Keep a bounded tombstone list so late calls fail as released, not unknown. */
	private rememberReleasedLocalRefId(id: string): void {
		if (this.releasedLocalRefIds.has(id)) return
		this.releasedLocalRefIds.add(id)
		this.releasedLocalRefIdOrder.push(id)
		while (this.releasedLocalRefIdOrder.length > MAX_RELEASED_LOCAL_REF_IDS) {
			const oldest = this.releasedLocalRefIdOrder.shift()
			if (oldest) this.releasedLocalRefIds.delete(oldest)
		}
	}

	/** Undo refs retained for a request/response that failed before leaving this channel. */
	private rollbackNewRefs(state: RewriteState): void {
		for (const ref of state.newRefs) {
			this.localRefs.delete(ref.id)
			if (
				ref.value &&
				ref.receiver &&
				this.localReceiverRefIds.get(ref.value)?.get(ref.receiver) === ref.id
			) {
				this.localReceiverRefIds.get(ref.value)?.delete(ref.receiver)
			}
			if (ref.value && this.localRefIds.get(ref.value) === ref.id) {
				this.localRefIds.delete(ref.value)
			}
		}
		state.newRefs.length = 0
	}

	/** Retain a local value and return the envelope that lets the remote call it back. */
	private retainLocalRef(
		kind: RemoteRefKind,
		value: unknown,
		state: RewriteState,
		receiver?: unknown
	): RemoteRefEnvelope {
		if (!this.supportsRemoteRefs) {
			throw new RPCEncodeError("RPC channel does not support remote references")
		}
		const record = getRemoteProxyRecord(value)
		if (record) {
			if (record.kind === "object" && record.path && record.path.length > 0) {
				return { [REMOTE_REF_TAG]: true, id: record.id, kind: record.kind, p: record.path }
			}
			return { [REMOTE_REF_TAG]: true, id: record.id, kind: record.kind }
		}
		if (
			receiver === undefined &&
			(typeof value === "object" || typeof value === "function") &&
			value !== null
		) {
			const existingId = this.localRefIds.get(value)
			if (existingId) return { [REMOTE_REF_TAG]: true, id: existingId, kind }
		}
		if (
			(typeof value === "object" || typeof value === "function") &&
			value !== null &&
			(typeof receiver === "object" || typeof receiver === "function") &&
			receiver !== null
		) {
			const existingId = this.localReceiverRefIds.get(value)?.get(receiver)
			if (existingId) return { [REMOTE_REF_TAG]: true, id: existingId, kind }
		}

		const id = generateId()
		this.localRefs.set(id, { kind, value, receiver, released: false })
		if (
			(typeof value === "object" || typeof value === "function") &&
			value !== null &&
			(typeof receiver === "object" || typeof receiver === "function") &&
			receiver !== null
		) {
			let receiverIds = this.localReceiverRefIds.get(value)
			if (!receiverIds) {
				receiverIds = new WeakMap()
				this.localReceiverRefIds.set(value, receiverIds)
			}
			receiverIds.set(receiver, id)
			state.newRefs.push({ id, value, receiver })
		} else if (
			receiver === undefined &&
			(typeof value === "object" || typeof value === "function") &&
			value !== null
		) {
			this.localRefIds.set(value, id)
			state.newRefs.push({ id, value })
		} else {
			state.newRefs.push({ id })
		}
		return { [REMOTE_REF_TAG]: true, id, kind }
	}

	/** Create a callable proxy that forwards invocation to the remote owner. */
	private createRemoteFunction(ref: RemoteRefEnvelope): (...args: unknown[]) => Promise<unknown> {
		let released = false
		const remoteFunction = (...args: unknown[]) => {
			if (released) return Promise.reject(new RPCRemoteReferenceReleasedError(ref.id))
			return this.request("ref", [ref.id, "apply"], args)
		}
		const record: RemoteProxyRecord = {
			id: ref.id,
			kind: ref.kind,
			get released() {
				return released
			},
			release: async () => {
				await this.request("ref", [ref.id, "release"])
			},
			markReleased() {
				released = true
			}
		}
		this.remoteProxyRecords.add(record)
		registerRemoteProxy(remoteFunction, record)
		return remoteFunction
	}

	/** Create a path-building object proxy for remote property get/set/method calls. */
	private createRemoteObject(ref: RemoteRefEnvelope): object {
		const releaseState = { released: false }
		const request = (
			action: "get" | "set" | "call",
			path: string[],
			args?: unknown[],
			value?: unknown
		) => {
			if (releaseState.released) return Promise.reject(new RPCRemoteReferenceReleasedError(ref.id))
			if (action === "set") return this.request("ref", [ref.id, action, ...path], args, value)
			return this.request("ref", [ref.id, action, ...path], args)
		}
		const createNode = (path: string[]): object => {
			const target = function () {}
			const remoteObject = new Proxy(target, {
				get: (target, property, receiver) => {
					if (property === "then") {
						if (path.length === 0) return undefined
						const promise = request("get", path)
						return promise.then.bind(promise)
					}
					if (typeof property === "symbol") return Reflect.get(target, property, receiver)
					return createNode([...path, property])
				},
				set: (_target, property, value) => {
					if (typeof property === "symbol") return false
					void request("set", [...path, property], undefined, value).catch(() => {})
					return true
				},
				apply: (_target, _thisArg, args) => request("call", path, Array.from(args))
			})
			const record: RemoteProxyRecord = {
				id: ref.id,
				kind: ref.kind,
				path,
				get released() {
					return releaseState.released
				},
				release: async () => {
					await this.request("ref", [ref.id, "release"])
				},
				markReleased() {
					releaseState.released = true
				}
			}
			this.remoteProxyRecords.add(record)
			registerRemoteProxy(remoteObject, record)
			return remoteObject
		}
		return createNode(ref.p ?? [])
	}

	/** Execute apply/get/set/call/release against a local reference owned by this channel. */
	private async executeRefRequest(message: RPCRequest): Promise<unknown> {
		const [refId, action] = message.p
		if (!refId) throw new Error("Missing remote reference id")
		if (action === "release") {
			const ref = this.localRefs.get(refId)
			if (!ref) return true
			if (
				(typeof ref.value === "object" || typeof ref.value === "function") &&
				ref.value !== null &&
				(typeof ref.receiver === "object" || typeof ref.receiver === "function") &&
				ref.receiver !== null &&
				this.localReceiverRefIds.get(ref.value)?.get(ref.receiver) === refId
			) {
				this.localReceiverRefIds.get(ref.value)?.delete(ref.receiver)
			}
			if (
				(typeof ref.value === "object" || typeof ref.value === "function") &&
				ref.value !== null &&
				this.localRefIds.get(ref.value) === refId
			) {
				this.localRefIds.delete(ref.value)
			}
			ref.released = true
			ref.value = undefined
			ref.receiver = undefined
			this.localRefs.delete(refId)
			this.rememberReleasedLocalRefId(refId)
			return true
		}
		const ref = this.localRefs.get(refId)
		if (!ref && this.releasedLocalRefIds.has(refId)) throw new RPCRemoteReferenceReleasedError(refId)
		if (!ref) throw new Error(`Unknown remote reference ${refId}`)
		if (ref.released) throw new RPCRemoteReferenceReleasedError(refId)
		const value = ref.value
		if (action === "apply") {
			if (ref.kind !== "function" || typeof value !== "function") {
				throw new Error(`Remote reference ${refId} is not a function`)
			}
			return await Reflect.apply(value, ref.receiver, this.decodeArgs(message.a ?? []))
		}
		if (ref.kind !== "object") throw new Error(`Remote reference ${refId} is not an object`)
		if ((typeof value !== "object" && typeof value !== "function") || value === null) {
			throw new Error(`Remote reference ${refId} is not an object`)
		}
		const path = message.p.slice(2)
		if (action === "get") return getPath(value, path)
		if (action === "set") {
			const { parent, key } = getParent(value, path)
			if (!Reflect.set(parent, key, this.decodeRoot(message.v))) {
				throw new Error(`Cannot set remote reference property ${path.join(".")}`)
			}
			return true
		}
		if (action === "call") {
			const target = getPath(value, path)
			if (typeof target !== "function") throw new Error(`${path.join(".")} is not a function`)
			const receiver = path.length > 0 ? getPath(value, path.slice(0, -1)) : undefined
			return await Reflect.apply(target, receiver, this.decodeArgs(message.a ?? []))
		}
		throw new Error(`Unsupported remote reference operation ${action ?? ""}`)
	}
}
