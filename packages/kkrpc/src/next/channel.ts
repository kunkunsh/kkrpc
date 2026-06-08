/**
 * Core RPC channel implementation for kkrpc/next.
 *
 * `RPCChannel` is the only stateful runtime in the vNext core. It turns local
 * property/function access into compact protocol messages, tracks pending
 * requests, serializes errors, exposes callbacks, and invokes receive-side
 * plugins. It depends only on the protocol, transport interface, plugin hooks,
 * and transferable marker helper.
 *
 * This file intentionally does not import concrete transports, codecs,
 * validation, middleware, SuperJSON, or classic compatibility. Those features
 * compose around the channel through separate package entry points so bundlers
 * can remove unused code.
 *
 * @example
 * ```ts
 * import { RPCChannel } from "kkrpc/next"
 *
 * const server = new RPCChannel(serverTransport, {
 * 	expose: { add: (a: number, b: number) => a + b }
 * })
 * const client = new RPCChannel<object, { add(a: number, b: number): Promise<number> }>(
 * 	clientTransport
 * )
 *
 * const api = client.getAPI()
 * await api.add(1, 2)
 * server.destroy()
 * client.destroy()
 * ```
 */

import { takeTransferDescriptor } from "../transfer.ts"
import type { RPCError, RPCMessage, RPCOperation, RPCRequest } from "./protocol.ts"
import {
	runErrorHooks,
	runHandlerHooks,
	runRequestHooks,
	runResponseHooks,
	type RPCPlugin
} from "./plugins.ts"
import type { Transport } from "./transport.ts"

export interface RPCChannelOptions<LocalAPI extends object = object> {
	expose?: LocalAPI
	timeout?: number
	enableTransfer?: boolean
	plugins?: RPCPlugin[]
}

type PendingRequest = {
	resolve(value: unknown): void
	reject(error: Error): void
	timer?: ReturnType<typeof setTimeout>
}

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
 * Bidirectional RPC endpoint over a `Transport<RPCMessage>`.
 *
 * Each channel can expose a local API, consume a remote API, or both. For the
 * most common cases prefer `wrap()` and `expose()` from `kkrpc/next`; use this
 * class directly when you need explicit lifecycle control or both local and
 * remote APIs on the same endpoint.
 */
export class RPCChannel<LocalAPI extends object = object, RemoteAPI extends object = object> {
	private callbacks = new Map<string, (...args: unknown[]) => unknown>()
	private destroyed = false
	private pending = new Map<string, PendingRequest>()
	private supportsTransfer: boolean
	private unsubscribe: () => void
	private timeout: number
	private expose?: LocalAPI
	private plugins: readonly RPCPlugin[]

	constructor(
		private transport: Transport<RPCMessage>,
		options: RPCChannelOptions<LocalAPI> = {}
	) {
		this.expose = options.expose
		this.plugins = options.plugins ?? []
		this.supportsTransfer = options.enableTransfer !== false && transport.capabilities?.transfer === true
		this.timeout = options.timeout ?? 30_000
		this.unsubscribe = transport.subscribe((message) => void this.handleMessage(message))
	}

/**
 * Create the typed proxy for the remote API.
 *
 * @example
 * ```ts
 * const channel = new RPCChannel<object, { ping(): Promise<string> }>(transport)
 * const api = channel.getAPI()
 * await api.ping()
 * ```
 */
	getAPI(): RemoteAPI {
		return this.createProxy([]) as RemoteAPI
	}

/** Destroy the channel, reject pending requests, clear callbacks, and close the transport. */
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

	private createProxy(path: string[]): unknown {
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

	private request(op: RPCOperation, path: string[], args?: unknown[], value?: unknown): Promise<unknown> {
		if (this.destroyed) return Promise.reject(new Error("RPC channel destroyed"))
		const id = generateId()
		const transfers: Transferable[] = []
		const message: RPCRequest = { t: "q", id, op, p: path }
		if (args) message.a = this.encodeArgs(args, transfers)
		if (arguments.length >= 4) message.v = this.encodeValue(value, transfers)

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

	private post(message: RPCMessage, transfers: Transferable[] = [], pendingId?: string): void {
		try {
			const result = this.transport.send(message, transfers)
			if (result instanceof Promise) {
				void result.catch((error) => this.rejectPendingWrite(pendingId, error))
			}
		} catch (error) {
			this.rejectPendingWrite(pendingId, error)
		}
	}

	private rejectPendingWrite(pendingId: string | undefined, error: unknown): void {
		if (!pendingId) return
		const pending = this.pending.get(pendingId)
		if (!pending) return
		this.pending.delete(pendingId)
		if (pending.timer) clearTimeout(pending.timer)
		pending.reject(error instanceof Error ? error : new Error(String(error)))
	}

	private async handleMessage(message: RPCMessage): Promise<void> {
		if (this.destroyed) return
		if (message.t === "r") {
			this.handleResponse(message.id, message.v, message.e)
			return
		}
		if (message.t === "cb") {
			const callback = this.callbacks.get(message.id)
			if (callback) void callback(...this.decodeArgs(message.a))
			return
		}
		await this.handleRequest(message)
	}

	private handleResponse(id: string, value: unknown, error?: RPCError): void {
		const pending = this.pending.get(id)
		if (!pending) return
		this.pending.delete(id)
		if (pending.timer) clearTimeout(pending.timer)
		if (error) {
			pending.reject(fromRPCError(error))
			return
		}
		pending.resolve(value)
	}

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

	private async executeRequest(message: RPCRequest): Promise<unknown> {
		if (!this.expose) throw new Error("No API exposed")
		const state: Record<string, unknown> = {}
		const requestCtx = {
			id: message.id,
			operation: message.op,
			path: message.p,
			method: message.p.join("."),
			args: this.decodeArgs(message.a ?? []),
			value: message.v,
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
				state
			}
			await runErrorHooks(this.plugins, errorCtx)
			throw errorCtx.error
		}
	}

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

	private decodeArgs(args: unknown[]): unknown[] {
		return args.map((arg) => {
			if (!isArgEnvelope(arg)) return arg
			if (arg[ARG_ENVELOPE_TAG] === "value") return arg.v
			if (arg[ARG_ENVELOPE_TAG] === "callback") {
				const id = arg.id
				return (...callbackArgs: unknown[]) => {
					const transfers: Transferable[] = []
					this.post({ t: "cb", id, a: this.encodeArgs(callbackArgs, transfers) }, transfers)
				}
			}
		})
	}

	private encodeValue(value: unknown, transfers: Transferable[]): unknown {
		const descriptor = this.supportsTransfer ? takeTransferDescriptor(value) : undefined
		if (!descriptor) return value
		transfers.push(...descriptor.transfers)
		return descriptor.value
	}
}
