import type { IoInterface } from "./interface.ts"
import {
	deserializeMessage,
	serializeMessage,
	type Message,
	type Response,
	type SerializationOptions
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
	private serializationOptions: SerializationOptions

	constructor(
		private io: Io,
		options?: {
			expose?: LocalAPI
			serialization?: SerializationOptions
		}
	) {
		console.warn("RPCChannel constructor")
		this.apiImplementation = options?.expose
		this.serializationOptions = options?.serialization || {}
		this.listen()
	}

	/**
	 * Exposes a local API implementation that can be called remotely
	 * @param api The local API implementation to expose
	 */
	expose(api: LocalAPI) {
		this.apiImplementation = api
	}

	/**
	 * Returns the IO interface used by this channel
	 * @returns The IO interface instance
	 */
	getIO(): Io {
		return this.io
	}

	/**
	 * Listens for incoming messages on the IO interface
	 * Handles message buffering and parsing
	 * @private
	 */
	private async listen(): Promise<void> {
		// console.error("start listening with", this.io.name)

		while (true) {
			const buffer = await this.io.read()
			if (!buffer) {
				continue
			}
			const bufferStr = typeof buffer === 'string' ? buffer : new TextDecoder('utf-8').decode(buffer)
			// console.error("bufferStr", bufferStr)
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

	/**
	 * Handles a single message string by parsing and routing it
	 * @param messageStr The message string to handle
	 * @private
	 */
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
					console.error("received unknown message type 2", parsedMessage, typeof parsedMessage)
				}
			})
			.catch((err) => {
				console.log(`(kkrpc stdout passthrough):`, messageStr)
			})
	}

	/**
	 * Calls a method on the remote API
	 * @param method The name of the method to call
	 * @param args Arguments to pass to the remote method
	 * @returns Promise that resolves with the result of the remote call
	 */
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
			this.io.write(serializeMessage(message, this.serializationOptions))
		})
	}

	/**
	 * Handles responses received from remote method calls
	 * @param response The response message to handle
	 * @private
	 */
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

	/**
	 * Handles incoming method call requests from the remote endpoint
	 * @param request The request message to handle
	 * @private
	 */
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

	/**
	 * Invokes a callback on the remote endpoint
	 * @param callbackId The ID of the callback to invoke
	 * @param args Arguments to pass to the callback
	 * @private
	 */
	private invokeCallback(callbackId: string, args: any[]): void {
		const message: Message = {
			id: generateUUID(),
			method: callbackId,
			args,
			type: "callback"
		}
		this.io.write(serializeMessage(message, this.serializationOptions))
	}

	/**
	 * Handles callback invocations received from the remote endpoint
	 * @param message The callback message to handle
	 * @private
	 */
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

	/**
	 * Sends a successful response back to the remote endpoint
	 * @param id The ID of the request being responded to
	 * @param result The result to send back
	 * @private
	 */
	private sendResponse<T>(id: string, result: T): void {
		const response: Message<Response<T>> = {
			id,
			method: "",
			args: { result },
			type: "response"
		}
		this.io.write(serializeMessage(response, this.serializationOptions))
	}

	/**
	 * Sends an error response back to the remote endpoint
	 * @param id The ID of the request being responded to
	 * @param error The error message to send back
	 * @private
	 */
	private sendError(id: string, error: string): void {
		const response: Message<Response<null>> = {
			id,
			method: "",
			args: { error },
			type: "response"
		}
		this.io.write(serializeMessage(response, this.serializationOptions))
	}

	/**
	 * Creates a nested proxy object for chaining remote method calls
	 * @param chain Array of method names in the chain
	 * @returns Proxy object that transforms property access into remote method calls
	 * @private
	 */
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

	/**
	 * Returns a proxy object that represents the remote API
	 * Methods called on this proxy will be executed on the remote endpoint
	 * @returns Proxy object representing the remote API
	 */
	public getAPI(): RemoteAPI {
		return this.createNestedProxy() as RemoteAPI
	}

	/**
	 * Frees up memory by clearing stored callbacks and callback cache
	 * Useful when dealing with many anonymous callback functions to prevent memory leaks
	 */
	freeCallbacks() {
		this.callbacks = {}
		this.callbackCache.clear()
	}
}
