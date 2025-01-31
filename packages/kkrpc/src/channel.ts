import type { IoInterface } from "./interface.ts"
import {
	deserializeMessage,
	serializeMessage,
	type Message,
	type Response
} from "./serialization.ts"
import { generateUUID } from "./utils.ts"

interface PendingRequest {
	resolve: (result: any) => void
	reject: (error: any) => void
}

interface CallbackFunction {
	(...args: any[]): void
}

/**
 * A bidirectional Stdio IPC channel in RPC style.
 * This allows 2 JS/TS processes to call each other's API like using libraries in RPC style,
 * without needing to deal with `argv`, `stdin`, `stdout` directly.
 */
export class RPCChannel<
	LocalAPI extends Record<string, any>,
	RemoteAPI extends Record<string, any>,
	Io extends IoInterface = IoInterface
> {
	private pendingRequests: Record<string, PendingRequest> = {}
	private callbacks: Record<string, CallbackFunction> = {}
	private callbackCache: Map<CallbackFunction, string> = new Map()
	private count: number = 0
	private messageStr = ""
	private apiImplementation?: LocalAPI

	constructor(
		private io: Io,
		options?: {
			expose?: LocalAPI
		}
	) {
		this.apiImplementation = options?.expose
		this.listen()
	}

	expose(api: LocalAPI) {
		this.apiImplementation = api
	}

	getIO(): Io {
		return this.io
	}

	private async listen(): Promise<void> {
		// console.error("start listening with", this.io.name)

		while (true) {
			const buffer = await this.io.read()
			if (!buffer) {
				continue
			}
			const bufferStr = buffer.toString("utf-8")
			if (bufferStr.trim().length === 0) {
				continue
			}
			this.messageStr += bufferStr
			const lastChar = this.messageStr[this.messageStr.length - 1]
			const msgsSplit = this.messageStr.split("\n")
			const msgs = lastChar === "\n" ? msgsSplit : msgsSplit.slice(0, -1) // remove the last incomplete message
			this.messageStr = lastChar === "\n" ? "" : (msgsSplit.at(-1) ?? "")

			for (const msgStr of msgs.map((msg) => msg.trim()).filter(Boolean)) {
				if (msgStr.startsWith("{")) {
					this.handleMessageStr(msgStr)
				} else {
					console.log(`(kkrpc stdout passthrough):`, msgStr) // allow debug log passthrough
				}
			}
		}
	}

	private async handleMessageStr(messageStr: string): Promise<void> {
		this.count++
		return deserializeMessage(messageStr)
			.then((parsedMessage) => {
				if (parsedMessage.type === "response") {
					this.handleResponse(parsedMessage as Message<Response<any>>)
				} else if (parsedMessage.type === "request") {
					this.handleRequest(parsedMessage)
				} else if (parsedMessage.type === "callback") {
					this.handleCallback(parsedMessage)
				} else {
					console.error("received unknown message type", parsedMessage, typeof parsedMessage)
				}
			})
			.catch((err) => {
				console.log(`(kkrpc stdout passthrough):`, messageStr)
			})
	}

	// Send a method call to the other process
	public callMethod<T extends keyof RemoteAPI>(method: T, args: any[]): Promise<void> {
		return new Promise((resolve, reject) => {
			const messageId = generateUUID()
			this.pendingRequests[messageId] = { resolve, reject }

			const callbackIds: string[] = []
			const processedArgs = args.map((arg) => {
				if (typeof arg === "function") {
					let callbackId = this.callbackCache.get(arg)
					if (!callbackId) {
						callbackId = generateUUID()
						this.callbacks[callbackId] = arg
						// console.log("callbacks size", Object.keys(this.callbacks).length);
						this.callbackCache.set(arg, callbackId)
					} else {
						//   console.log("callbackId already exists", callbackId);
					}
					callbackIds.push(callbackId)
					return `__callback__${callbackId}`
				}
				return arg
			})

			const message: Message = {
				id: messageId,
				method: method as string,
				args: processedArgs,
				type: "request",
				callbackIds: callbackIds.length > 0 ? callbackIds : undefined
			}
			this.io.write(serializeMessage(message))
		})
	}

	// Handle response to a request we sent
	private handleResponse(response: Message<Response<any>>): void {
		const { id } = response
		const { result, error } = response.args
		if (this.pendingRequests[id]) {
			if (error) {
				this.pendingRequests[id].reject(new Error(error))
			} else {
				this.pendingRequests[id].resolve(result)
			}
			delete this.pendingRequests[id]
		}
	}

	// Handle incoming requests from the other process using a Proxy
	private handleRequest(request: Message): void {
		const { id, method, args } = request

		// Split the method path and traverse the API implementation
		const methodPath = method.split(".")
		if (!this.apiImplementation) return
		let target: any = this.apiImplementation

		// Traverse the object path
		for (let i = 0; i < methodPath.length - 1; i++) {
			target = target[methodPath[i]]
			if (!target) {
				this.sendError(id, `Method path ${method} not found at ${methodPath[i]}`)
				return
			}
		}

		const finalMethod = methodPath[methodPath.length - 1]
		const targetMethod = target[finalMethod]

		if (typeof targetMethod !== "function") {
			this.sendError(id, `Method ${method} is not a function`)
			return
		}

		const processedArgs = args.map((arg: any) => {
			if (typeof arg === "string" && arg.startsWith("__callback__")) {
				const callbackId = arg.slice(12)
				return (...callbackArgs: any[]) => {
					this.invokeCallback(callbackId, callbackArgs)
				}
			}
			return arg
		})

		try {
			const result = targetMethod.apply(target, processedArgs)
			Promise.resolve(result)
				.then((res) => {
					return this.sendResponse(id, res)
				})
				.catch((err) => this.sendError(id, err.message))
		} catch (error: any) {
			this.sendError(id, error.message ?? error.toString())
		}
	}

	private invokeCallback(callbackId: string, args: any[]): void {
		const message: Message = {
			id: generateUUID(),
			method: callbackId,
			args,
			type: "callback"
		}
		this.io.write(serializeMessage(message))
	}

	private handleCallback(message: Message): void {
		const { method: callbackId, args } = message
		const callback = this.callbacks[callbackId]
		if (callback) {
			callback(...args)
			// delete this.callbacks[callbackId];
			// console.log("callback size", Object.keys(this.callbacks).length);
			// this.cleanupCallbacks();
		} else {
			console.error(`Callback with id ${callbackId} not found`)
		}
	}

	// Send a response to a request
	private sendResponse<T>(id: string, result: T): void {
		const response: Message<Response<T>> = {
			id,
			method: "",
			args: { result },
			type: "response"
		}
		this.io.write(serializeMessage(response))
	}

	// Send an error response
	private sendError(id: string, error: string): void {
		const response: Message<Response<null>> = {
			id,
			method: "",
			args: { error },
			type: "response"
		}
		this.io.write(serializeMessage(response))
	}

	private createNestedProxy(chain: string[] = []): any {
		return new Proxy(() => {}, {
			get: (_target, prop: string | symbol) => {
				// Prevent special properties like `toString` or `then` from being treated as part of the chain
				if (typeof prop === "string" && prop !== "then") {
					return this.createNestedProxy([...chain, prop])
				}
				return undefined
			},
			apply: (_target, _thisArg, args: any[]) => {
				const method = chain.join(".")
				return this.callMethod(method as keyof RemoteAPI, args)
			}
		})
	}

	public getAPI(): RemoteAPI {
		return this.createNestedProxy() as RemoteAPI
	}

	/**
	 * Free up the callback map and cache
	 * If you use callbacks a lot, you could get memory leak.
	 * e.g. If you use anonymous callback function in a 5000 iterations loop,
	 * you will get 5000 callbacks in cache. It's a better idea to free them.
	 *
	 * If you use a named callback function, there will be only one entry in the cache.
	 */
	freeCallbacks() {
		this.callbacks = {}
		this.callbackCache.clear()
	}
}
