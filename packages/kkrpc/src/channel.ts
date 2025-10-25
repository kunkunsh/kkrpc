import type { IoInterface } from "./interface.ts"
import {
	deserializeMessage,
	serializeMessage,
	type Message,
	type Response,
	type SerializationOptions,
	type EnhancedError,
	deserializeError,
	serializeError,
	proxyMarker,
	type ProxyMarked
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
		// console.warn("RPCChannel constructor")
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
				} else if (parsedMessage.type === "get") {
					this.handleGet(parsedMessage)
				} else if (parsedMessage.type === "set") {
					this.handleSet(parsedMessage)
				} else if (parsedMessage.type === "construct") {
					this.handleConstruct(parsedMessage)
				} else {
					console.error("received unknown message type", parsedMessage, typeof parsedMessage)
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
			const { data, transfers } = serializeMessage(message, this.serializationOptions)
			this.io.write(data, transfers || [])
		})
	}

	/**
	 * Gets a property value from the remote API
	 * @param path The property path (dot notation string or array)
	 * @returns Promise that resolves with the property value
	 */
	public getProperty(path: string | string[]): Promise<any> {
		return new Promise((resolve, reject) => {
			const messageId = generateUUID()
			this.pendingRequests[messageId] = { resolve, reject }

			const propertyPath = Array.isArray(path) ? path : path.split(".")
			const message: Message = {
				id: messageId,
				method: "",
				args: {},
				type: "get",
				path: propertyPath
			}
			const { data, transfers } = serializeMessage(message, this.serializationOptions)
			this.io.write(data, transfers || [])
		})
	}

	/**
	 * Sets a property value on the remote API
	 * @param path The property path (dot notation string or array)
	 * @param value The value to set
	 * @returns Promise that resolves when the property is set
	 */
	public setProperty(path: string | string[], value: any): Promise<void> {
		return new Promise((resolve, reject) => {
			const messageId = generateUUID()
			this.pendingRequests[messageId] = { resolve, reject }

			const propertyPath = Array.isArray(path) ? path : path.split(".")
			const message: Message = {
				id: messageId,
				method: "",
				args: {},
				type: "set",
				path: propertyPath,
				value: value
			}
			const { data, transfers } = serializeMessage(message, this.serializationOptions)
			this.io.write(data, transfers || [])
		})
	}

	/**
	 * Calls a constructor on the remote API
	 * @param constructor The name of the constructor to call
	 * @param args Arguments to pass to the remote constructor
	 * @returns Promise that resolves with the constructed instance
	 */
	public callConstructor<T extends keyof RemoteAPI>(constructor: T, args: any[]): Promise<any> {
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
						this.callbackCache.set(arg, callbackId)
					}
					callbackIds.push(callbackId)
					return `__callback__${callbackId}`
				}
				return arg
			})

			const message: Message = {
				id: messageId,
				method: constructor as string,
				args: processedArgs,
				type: "construct",
				callbackIds: callbackIds.length > 0 ? callbackIds : undefined
			}
			const { data, transfers } = serializeMessage(message, this.serializationOptions)
			this.io.write(data, transfers || [])
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
				// Handle enhanced error objects
				if (typeof error === 'object' && error.name && error.message) {
					this.pendingRequests[id].reject(deserializeError(error as EnhancedError))
				} else {
					// Fall back to simple string errors for backward compatibility
					this.pendingRequests[id].reject(new Error(error as string))
				}
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
				.catch((err) => this.sendError(id, err))
		} catch (error: any) {
			this.sendError(id, error)
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
		const { data, transfers } = serializeMessage(message, this.serializationOptions)
		this.io.write(data, transfers || [])
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
	 * Handles property get requests from the remote endpoint
	 * @param request The get request message to handle
	 * @private
	 */
	private handleGet(request: Message): void {
		const { id, path } = request
		if (!path || !this.apiImplementation) {
			this.sendError(id, "Invalid get request: missing path or API implementation")
			return
		}

		try {
			// Traverse the object path to get the property value
			let target: any = this.apiImplementation
			for (const prop of path) {
				target = target[prop]
				if (target === undefined) {
					this.sendError(id, `Property path ${path.join(".")} not found at ${prop}`)
					return
				}
			}
			this.sendResponse(id, target)
		} catch (error: any) {
			this.sendError(id, error)
		}
	}

	/**
	 * Handles property set requests from the remote endpoint
	 * @param request The set request message to handle
	 * @private
	 */
	private handleSet(request: Message): void {
		const { id, path, value } = request
		if (!path || !this.apiImplementation) {
			this.sendError(id, "Invalid set request: missing path or API implementation")
			return
		}

		try {
			// Traverse to the parent object
			let target: any = this.apiImplementation
			for (let i = 0; i < path.length - 1; i++) {
				target = target[path[i]]
				if (!target) {
					this.sendError(id, `Property path ${path.join(".")} not found at ${path[i]}`)
					return
				}
			}

			// Set the final property
			const finalProp = path[path.length - 1]
			target[finalProp] = value
			this.sendResponse(id, true) // Return true to indicate success
		} catch (error: any) {
			this.sendError(id, error)
		}
	}

	/**
	 * Handles constructor calls from the remote endpoint
	 * @param request The construct request message to handle
	 * @private
	 */
	private handleConstruct(request: Message): void {
		const { id, method, args } = request

		// Split the method path and traverse the API implementation
		const methodPath = method.split(".")
		if (!this.apiImplementation) {
			this.sendError(id, "No API implementation available")
			return
		}
		let target: any = this.apiImplementation

		// Traverse the object path
		for (let i = 0; i < methodPath.length - 1; i++) {
			target = target[methodPath[i]]
			if (!target) {
				this.sendError(id, `Constructor path ${method} not found at ${methodPath[i]}`)
				return
			}
		}

		const finalMethod = methodPath[methodPath.length - 1]
		const ConstructorClass = target[finalMethod]

		if (typeof ConstructorClass !== "function") {
			this.sendError(id, `${method} is not a constructor function`)
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
			const instance = new ConstructorClass(...processedArgs)
			this.sendResponse(id, instance)
		} catch (error: any) {
			this.sendError(id, error)
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
		const { data, transfers } = serializeMessage(response, this.serializationOptions)
		this.io.write(data, transfers || [])
	}

	/**
	 * Sends an error response back to the remote endpoint
	 * @param id The ID of the request being responded to
	 * @param error The error message or Error object to send back
	 * @private
	 */
	private sendError(id: string, error: string | Error): void {
		const errorResponse = error instanceof Error 
			? serializeError(error)
			: error;
		
		const response: Message<Response<null>> = {
			id,
			method: "",
			args: { error: errorResponse },
			type: "response"
		}
		const { data, transfers } = serializeMessage(response, this.serializationOptions)
		this.io.write(data, transfers || [])
	}

	/**
	 * Creates a nested proxy object for chaining remote method calls, property access, and constructor calls
	 * @param chain Array of method names in the chain
	 * @returns Proxy object that transforms property access into remote method calls
	 * @private
	 */
	private createNestedProxy(chain: string[] = []): any {
		return new Proxy(() => {}, {
			get: (_target, prop: string | symbol) => {
				// Handle special properties
				if (typeof prop === "string") {
					// Handle property access like obj.prop
					if (prop !== "then") {
						return this.createNestedProxy([...chain, prop])
					}
					// Handle thenable for await support
					if (prop === "then" && chain.length > 0) {
						// Return property value when accessed like: await obj.prop
						const promise = this.getProperty(chain)
						return promise.then.bind(promise)
					}
				}
				return undefined
			},
			set: (_target, prop: string | symbol, value: any) => {
				// Handle property setting like obj.prop = value
				if (typeof prop === "string") {
					const propertyPath = [...chain, prop]
					this.setProperty(propertyPath, value)
					return true
				}
				return false
			},
			apply: (_target, _thisArg, args: any[]) => {
				// Handle method calls like obj.method()
				const method = chain.join(".")
				return this.callMethod(method as keyof RemoteAPI, args)
			},
			construct: (_target, args: any[]) => {
				// Handle constructor calls like new obj.Constructor()
				return this.callConstructor(chain.join(".") as keyof RemoteAPI, args)
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
