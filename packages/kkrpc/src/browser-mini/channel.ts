import { takeTransferDescriptor } from "../transfer.ts"
import type { MiniError, MiniMessage, MiniOperation, MiniRequest, MiniTransport } from "./types.ts"

export type { MiniMessage, MiniTransport } from "./types.ts"

export interface RPCChannelOptions<LocalAPI extends object = object> {
	expose?: LocalAPI
	timeout?: number
	enableTransfer?: boolean
}

type PendingRequest = {
	resolve(value: unknown): void
	reject(error: Error): void
	timer?: ReturnType<typeof setTimeout>
}

const CALLBACK_PREFIX = "__kkrpc_mini_callback__"
const NATIVE_FUNCTION_PROPERTIES = new Set(["apply", "bind", "call", "toString"])

function generateId(): string {
	return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

function toMiniError(error: unknown): MiniError {
	if (error instanceof Error) {
		return { n: error.name, m: error.message, s: error.stack }
	}
	return { n: "Error", m: String(error) }
}

function fromMiniError(error: MiniError): Error {
	const result = new Error(error.m)
	result.name = error.n
	if (error.s) result.stack = error.s
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

export class RPCChannel<LocalAPI extends object = object, RemoteAPI extends object = object> {
	private callbacks = new Map<string, (...args: unknown[]) => unknown>()
	private destroyed = false
	private pending = new Map<string, PendingRequest>()
	private supportsTransfer: boolean
	private unsubscribe: () => void
	private timeout: number
	private expose?: LocalAPI

	constructor(
		private transport: MiniTransport,
		options: RPCChannelOptions<LocalAPI> = {}
	) {
		this.expose = options.expose
		this.supportsTransfer = options.enableTransfer !== false && transport.canTransfer !== false
		this.timeout = options.timeout ?? 30_000
		this.unsubscribe = transport.onMessage((message) => this.handleMessage(message))
	}

	getAPI(): RemoteAPI {
		return this.createProxy([]) as RemoteAPI
	}

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
		this.transport.destroy?.()
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
				if (NATIVE_FUNCTION_PROPERTIES.has(property)) return Reflect.get(target, property, receiver)
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

	private request(op: MiniOperation, path: string[], args?: unknown[], value?: unknown): Promise<unknown> {
		if (this.destroyed) return Promise.reject(new Error("RPC channel destroyed"))
		const id = generateId()
		const transfers: Transferable[] = []
		const message: MiniRequest = { t: "q", id, op, p: path }
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

	private post(message: MiniMessage, transfers: Transferable[] = [], pendingId?: string): void {
		try {
			const result = this.transport.post(message, transfers)
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

	private async handleMessage(message: MiniMessage): Promise<void> {
		if (this.destroyed) return
		if (message.t === "r") {
			this.handleResponse(message.id, message.v, message.e)
			return
		}
		if (message.t === "cb") {
			const callback = this.callbacks.get(message.id)
			if (callback) void callback(...message.a)
			return
		}
		await this.handleRequest(message)
	}

	private handleResponse(id: string, value: unknown, error?: MiniError): void {
		const pending = this.pending.get(id)
		if (!pending) return
		this.pending.delete(id)
		if (pending.timer) clearTimeout(pending.timer)
		if (error) {
			pending.reject(fromMiniError(error))
			return
		}
		pending.resolve(value)
	}

	private async handleRequest(message: MiniRequest): Promise<void> {
		const transfers: Transferable[] = []
		try {
			const value = await this.executeRequest(message)
			this.post({ t: "r", id: message.id, v: this.encodeValue(value, transfers) }, transfers)
		} catch (error) {
			this.post({ t: "r", id: message.id, e: toMiniError(error) })
		}
	}

	private async executeRequest(message: MiniRequest): Promise<unknown> {
		if (!this.expose) throw new Error("No API exposed")
		if (message.op === "get") return getPath(this.expose, message.p)
		if (message.op === "set") {
			const { parent, key } = getParent(this.expose, message.p)
			Reflect.set(parent, key, message.v)
			return true
		}

		const target = getPath(this.expose, message.p)
		const args = this.decodeArgs(message.a ?? [])
		if (message.op === "new") {
			return Reflect.construct(target as new (...args: unknown[]) => unknown, args)
		}
		if (typeof target !== "function") throw new Error(`${message.p.join(".")} is not a function`)
		const receiver = message.p.length > 0 ? getPath(this.expose, message.p.slice(0, -1)) : undefined
		return await Reflect.apply(target, receiver, args)
	}

	private encodeArgs(args: unknown[], transfers: Transferable[]): unknown[] {
		return args.map((arg) => {
			if (typeof arg === "function") {
				const id = generateId()
				this.callbacks.set(id, arg as (...args: unknown[]) => unknown)
				return `${CALLBACK_PREFIX}${id}`
			}
			return this.encodeValue(arg, transfers)
		})
	}

	private decodeArgs(args: unknown[]): unknown[] {
		return args.map((arg) => {
			if (typeof arg === "string" && arg.startsWith(CALLBACK_PREFIX)) {
				const id = arg.slice(CALLBACK_PREFIX.length)
				return (...callbackArgs: unknown[]) => {
					const transfers: Transferable[] = []
					this.post(
						{ t: "cb", id, a: this.encodeArgs(callbackArgs, transfers) },
						transfers
					)
				}
			}
			return arg
		})
	}

	private encodeValue(value: unknown, transfers: Transferable[]): unknown {
		const descriptor = this.supportsTransfer ? takeTransferDescriptor(value) : undefined
		if (!descriptor) return value
		transfers.push(...descriptor.transfers)
		return descriptor.value
	}
}
