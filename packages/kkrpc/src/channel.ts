import type { IoInterface, IoMessage } from "./interface.ts"
import {
	decodeMessage,
	deserializeError,
	encodeMessage,
	processValueForTransfer,
	reconstructValueFromTransfer,
	serializeError,
	type EnhancedError,
	type Message,
	type Response,
	type SerializationOptions,
	type TransferSlot
} from "./serialization.ts"
import { generateUUID } from "./utils.ts"
import { runInterceptors, type RPCInterceptor } from "./middleware.ts"
import {
	lookupValidator,
	RPCValidationError,
	runValidation,
	type RPCValidators
} from "./validation.ts"

// ---------------------------------------------------------------------------
// RPCTimeoutError
// ---------------------------------------------------------------------------

/**
 * Error thrown when an RPC call exceeds the configured timeout.
 *
 * Custom properties (`method`, `timeoutMs`) survive kkrpc's
 * `serializeError()` / `deserializeError()` round-trip (same mechanism
 * as `RPCValidationError`).
 */
export class RPCTimeoutError extends Error {
	public readonly method: string
	public readonly timeoutMs: number

	constructor(method: string, timeoutMs: number) {
		super(`RPC call to "${method}" timed out after ${timeoutMs}ms`)
		this.name = "RPCTimeoutError"
		this.method = method
		this.timeoutMs = timeoutMs
	}
}

/**
 * Type guard for RPCTimeoutError.
 *
 * Uses `.name` check (not `instanceof`) so it works on deserialized
 * errors received over the wire.
 */
export function isRPCTimeoutError(error: unknown): error is RPCTimeoutError {
	return error instanceof Error && error.name === "RPCTimeoutError"
}

interface PendingRequest {
	resolve: (result: any) => void
	reject: (error: any) => void
}

interface CallbackFunction {
	(...args: unknown[]): void
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
	private pendingTimers: Record<string, ReturnType<typeof setTimeout>> = {}
	private callbacks: Record<string, CallbackFunction> = {}
	private callbackCache: Map<CallbackFunction, string> = new Map()
	private count: number = 0
	private messageStr = ""
	private apiImplementation?: LocalAPI
	/**
	 * Optional validators map that mirrors the LocalAPI shape.
	 * When set, incoming RPC calls are validated before the handler runs (input)
	 * and after it returns (output). Validation only applies to the locally
	 * exposed API — kkrpc is bidirectional, so each side validates its own API.
	 */
	private validators?: RPCValidators<LocalAPI>
	/** Interceptor chain that wraps handler invocation in handleRequest. */
	private interceptors: ReadonlyArray<RPCInterceptor>
	private serializationOptions: SerializationOptions
	private supportsTransfer = false
	private structuredClone = false
	/** Timeout in ms for outgoing RPC calls. 0 or Infinity means no timeout. */
	private timeout: number

	constructor(
		private io: Io,
		options?: {
			expose?: LocalAPI
			serialization?: SerializationOptions
			enableTransfer?: boolean
			/** Optional validators for the exposed API. Validates inputs/outputs on the receiving side. */
			validators?: RPCValidators<LocalAPI>
			/** Interceptors that wrap handler invocation on the receiving side. */
			interceptors?: RPCInterceptor[]
			/** Timeout in ms for outgoing RPC calls. Default: 0 (no timeout). */
			timeout?: number
		}
	) {
		this.apiImplementation = options?.expose
		this.validators = options?.validators
		this.interceptors = options?.interceptors ?? []
		this.timeout = options?.timeout ?? 0
		this.serializationOptions = options?.serialization || {}
		this.structuredClone = io.capabilities?.structuredClone === true
		if (
			this.structuredClone &&
			io.capabilities?.transfer === true &&
			options?.enableTransfer !== false
		) {
			this.supportsTransfer = true
		}
		this.listen()
	}

	/**
	 * Exposes a local API implementation that can be called remotely
	 * @param api The local API implementation to expose
	 */
	expose(api: LocalAPI, validators?: RPCValidators<LocalAPI>) {
		this.apiImplementation = api
		if (validators) this.validators = validators
	}

	/**
	 * Returns the IO interface used by this channel
	 * @returns The IO interface instance
	 */
	getIO(): Io {
		return this.io
	}

	/**
	 * Listens for incoming messages on the IO interface and dispatches them.
	 */
	private async listen(): Promise<void> {
		while (true) {
			// Check if IO interface is destroyable and has been destroyed
			if (
				"isDestroyed" in this.io &&
				(this.io as Record<string, unknown>).isDestroyed
			) {
				break
			}

			try {
				const incoming = await this.io.read()
				if (incoming === null || incoming === undefined) {
					continue
				}
				await this.handleIncomingMessage(incoming)
			} catch (error: unknown) {
				// If the error indicates the adapter is destroyed, stop listening
				if (error instanceof Error && error.message.includes("destroyed")) {
					break
				}
				console.error("kkrpc: failed to handle incoming message", error)
			}
		}
	}

	private async handleIncomingMessage(raw: string | IoMessage): Promise<void> {
		if (typeof raw === "string") {
			if (raw.trim().length === 0) {
				return
			}
			this.bufferString(raw)
			return
		}

		const payload = raw.data
		if (typeof payload === "string") {
			await this.handleIncomingMessage(payload)
			return
		}

		if (!payload || typeof payload !== "object") {
			return
		}

		if (!payload.__transferredValues && raw.transfers && raw.transfers.length > 0) {
			payload.__transferredValues = raw.transfers
		}

		const message = await decodeMessage(payload)
		await this.processDecodedMessage(message)
	}

	private bufferString(chunk: string): void {
		this.messageStr += chunk
		const lastChar = this.messageStr[this.messageStr.length - 1]
		const msgsSplit = this.messageStr.split("\n")
		const msgs = lastChar === "\n" ? msgsSplit : msgsSplit.slice(0, -1)
		this.messageStr = lastChar === "\n" ? "" : (msgsSplit.at(-1) ?? "")

		for (const msgStr of msgs.map((msg) => msg.trim()).filter(Boolean)) {
			if (msgStr.startsWith("{")) {
				void this.handleMessageStr(msgStr)
			} else {
				console.log(`(kkrpc stdout passthrough):`, msgStr)
			}
		}
	}

	private async handleMessageStr(messageStr: string): Promise<void> {
		this.count++
		try {
			const parsedMessage = await decodeMessage(messageStr)
			await this.processDecodedMessage(parsedMessage)
		} catch (error) {
			console.error("failed to parse message", typeof messageStr, messageStr, error)
		}
	}

	private async processDecodedMessage(parsedMessage: Message): Promise<void> {
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
			this.startTimeout(messageId, method as string)

			const callbackIds: string[] = []
			const argsWithCallbacks = args.map((arg) => {
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

			let finalArgs = argsWithCallbacks
			const transferables: Transferable[] = []
			const transferSlots: TransferSlot[] = []
			const transferredValues: unknown[] = []

			if (this.supportsTransfer) {
				finalArgs = argsWithCallbacks.map((arg) =>
					processValueForTransfer(arg, transferables, transferSlots, transferredValues)
				)
			}

			const message: Message = {
				id: messageId,
				method: method as string,
				args: finalArgs,
				type: "request",
				callbackIds: callbackIds.length > 0 ? callbackIds : undefined,
				transferSlots: transferSlots.length > 0 ? transferSlots : undefined
			}

			this.sendMessage(message, transferables, transferredValues)
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
			this.startTimeout(messageId, `get:${propertyPath.join(".")}`)
			const message: Message = {
				id: messageId,
				method: "",
				args: {},
				type: "get",
				path: propertyPath
			}
			this.sendMessage(message)
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
			this.startTimeout(messageId, `set:${propertyPath.join(".")}`)
			let processedValue = value
			const transferables: Transferable[] = []
			const transferSlots: TransferSlot[] = []
			const transferredValues: unknown[] = []

			if (this.supportsTransfer) {
				processedValue = processValueForTransfer(
					value,
					transferables,
					transferSlots,
					transferredValues
				)
			}

			const message: Message = {
				id: messageId,
				method: "",
				args: {},
				type: "set",
				path: propertyPath,
				value: processedValue,
				transferSlots: transferSlots.length > 0 ? transferSlots : undefined
			}

			this.sendMessage(message, transferables, transferredValues)
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
			this.startTimeout(messageId, constructor as string)

			const callbackIds: string[] = []
			const argsWithCallbacks = args.map((arg) => {
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

			let finalArgs = argsWithCallbacks
			const transferables: Transferable[] = []
			const transferSlots: TransferSlot[] = []
			const transferredValues: unknown[] = []

			if (this.supportsTransfer) {
				finalArgs = argsWithCallbacks.map((arg) =>
					processValueForTransfer(arg, transferables, transferSlots, transferredValues)
				)
			}

			const message: Message = {
				id: messageId,
				method: constructor as string,
				args: finalArgs,
				type: "construct",
				callbackIds: callbackIds.length > 0 ? callbackIds : undefined,
				transferSlots: transferSlots.length > 0 ? transferSlots : undefined
			}

			this.sendMessage(message, transferables, transferredValues)
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
			this.clearTimeout(id)
			if (error) {
				// Handle enhanced error objects
				if (typeof error === "object" && error.name && error.message) {
					this.pendingRequests[id].reject(deserializeError(error as EnhancedError))
				} else {
					// Fall back to simple string errors for backward compatibility
					this.pendingRequests[id].reject(new Error(error as string))
				}
			} else {
				let finalResult = result
				if (response.transferSlots && response.transferSlots.length > 0) {
					const transferredValues = (response as any).__transferredValues || []
					finalResult = reconstructValueFromTransfer(
						result,
						response.transferSlots,
						transferredValues
					)
				}
				this.pendingRequests[id].resolve(finalResult)
			}
			delete this.pendingRequests[id]
		}
	}

	/**
	 * Handles incoming method call requests from the remote endpoint
	 * @param request The request message to handle
	 * @private
	 */
	private async handleRequest(request: Message): Promise<void> {
		const { id, method } = request
		let incomingArgs = Array.isArray(request.args) ? request.args : []

		if (request.transferSlots && request.transferSlots.length > 0) {
			const transferredValues = (request as any).__transferredValues || []
			incomingArgs = incomingArgs.map((arg: any) =>
				reconstructValueFromTransfer(arg, request.transferSlots!, transferredValues)
			)
		}

		const methodPath = method.split(".")
		if (!this.apiImplementation) return
		let target: any = this.apiImplementation

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

		// Restore callback arguments: the caller serialized callback functions as
		// "__callback__<id>" placeholder strings. Here we convert them back into
		// real functions that, when called, send a callback message to the remote side.
		const processedArgs = incomingArgs.map((arg: any) => {
			if (typeof arg === "string" && arg.startsWith("__callback__")) {
				const callbackId = arg.slice(12)
				return (...callbackArgs: any[]) => {
					this.invokeCallback(callbackId, callbackArgs)
				}
			}
			return arg
		})

		// --- Input / Output Validation ---
		// Look up the validator for this method path (e.g. "math.divide").
		// If no validators were configured, or this method has none, this is undefined
		// and validation is skipped entirely (backward-compatible no-op).
		const methodValidator = lookupValidator(this.validators, method)

		if (methodValidator?.input) {
			// Filter out callback arguments before validating. After the .map() above,
			// callback placeholders have been replaced with real functions, so we filter
			// by `typeof a !== "function"`. This matches the FilterCallbacks<T> type
			// utility that strips function params from the schema's expected input tuple.
			const dataArgs = processedArgs.filter((a: any) => typeof a !== "function")
			const inputResult = await runValidation(methodValidator.input, dataArgs)
			// Use `=== false` (not `!`) for discriminated union narrowing — without a
			// tsconfig, tsc doesn't narrow `!result.success` to the failure branch.
			if (inputResult.success === false) {
				this.sendError(id, new RPCValidationError("input", method, inputResult.issues))
				return
			}
		}

		try {
			// Wrap the handler invocation with the interceptor chain.
			// Interceptors run after input validation, so they see clean args.
			const invokeHandler = () => targetMethod.apply(target, processedArgs)
			const result =
				this.interceptors.length > 0
					? await runInterceptors(
							this.interceptors,
							{ method, args: processedArgs, state: {} },
							invokeHandler
						)
					: await invokeHandler()

			// Output validation: if an output schema is defined, validate the handler's
			// return value before sending it back. This catches bugs where the handler
			// returns an unexpected type (e.g. number instead of string).
			if (methodValidator?.output) {
				const outputResult = await runValidation(methodValidator.output, result)
				if (outputResult.success === false) {
					this.sendError(id, new RPCValidationError("output", method, outputResult.issues))
					return
				}
				// Send the validated value (which may have been transformed/coerced by the schema)
				this.sendResponse(id, outputResult.value)
				return
			}

			this.sendResponse(id, result)
		} catch (error: unknown) {
			this.sendError(id, error instanceof Error ? error : new Error(String(error)))
		}
	}

	/**
	 * Invokes a callback on the remote endpoint
	 * @param callbackId The ID of the callback to invoke
	 * @param args Arguments to pass to the callback
	 * @private
	 */
	private invokeCallback(callbackId: string, args: any[]): void {
		let finalArgs = args
		const transferables: Transferable[] = []
		const transferSlots: TransferSlot[] = []
		const transferredValues: unknown[] = []

		if (this.supportsTransfer) {
			finalArgs = args.map((arg) =>
				processValueForTransfer(arg, transferables, transferSlots, transferredValues)
			)
		}

		const message: Message = {
			id: generateUUID(),
			method: callbackId,
			args: finalArgs,
			type: "callback",
			transferSlots: transferSlots.length > 0 ? transferSlots : undefined
		}
		this.sendMessage(message, transferables, transferredValues)
	}

	/**
	 * Handles callback invocations received from the remote endpoint
	 * @param message The callback message to handle
	 * @private
	 */
	private handleCallback(message: Message): void {
		const { method: callbackId } = message
		const callback = this.callbacks[callbackId]
		if (callback) {
			let callbackArgs = Array.isArray(message.args) ? message.args : []
			if (message.transferSlots && message.transferSlots.length > 0) {
				const transferredValues = (message as any).__transferredValues || []
				callbackArgs = callbackArgs.map((arg: any) =>
					reconstructValueFromTransfer(arg, message.transferSlots!, transferredValues)
				)
			}
			callback(...callbackArgs)
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
		} catch (error: unknown) {
			this.sendError(id, error instanceof Error ? error : new Error(String(error)))
		}
	}

	/**
	 * Handles property set requests from the remote endpoint
	 * @param request The set request message to handle
	 * @private
	 */
	private handleSet(request: Message): void {
		const { id, path } = request
		if (!path || !this.apiImplementation) {
			this.sendError(id, "Invalid set request: missing path or API implementation")
			return
		}

		let incomingValue = request.value
		if (request.transferSlots && request.transferSlots.length > 0) {
			const transferredValues = (request as any).__transferredValues || []
			incomingValue = reconstructValueFromTransfer(
				request.value,
				request.transferSlots,
				transferredValues
			)
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
			target[finalProp] = incomingValue
			this.sendResponse(id, true) // Return true to indicate success
		} catch (error: unknown) {
			this.sendError(id, error instanceof Error ? error : new Error(String(error)))
		}
	}

	/**
	 * Handles constructor calls from the remote endpoint
	 * @param request The construct request message to handle
	 * @private
	 */
	private handleConstruct(request: Message): void {
		const { id, method } = request
		let incomingArgs = Array.isArray(request.args) ? request.args : []

		if (request.transferSlots && request.transferSlots.length > 0) {
			const transferredValues = (request as any).__transferredValues || []
			incomingArgs = incomingArgs.map((arg: any) =>
				reconstructValueFromTransfer(arg, request.transferSlots!, transferredValues)
			)
		}

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

		const processedArgs = incomingArgs.map((arg: any) => {
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
		} catch (error: unknown) {
			this.sendError(id, error instanceof Error ? error : new Error(String(error)))
		}
	}

	/**
	 * Sends a successful response back to the remote endpoint
	 * @param id The ID of the request being responded to
	 * @param result The result to send back
	 * @private
	 */
	private sendResponse<T>(id: string, result: T): void {
		let responseResult = result
		const transferables: Transferable[] = []
		const transferSlots: TransferSlot[] = []
		const transferredValues: unknown[] = []

		if (this.supportsTransfer) {
			responseResult = processValueForTransfer(
				result,
				transferables,
				transferSlots,
				transferredValues
			)
		}

		const response: Message<Response<T>> = {
			id,
			method: "",
			args: { result: responseResult },
			type: "response",
			transferSlots: transferSlots.length > 0 ? transferSlots : undefined
		}

		this.sendMessage(response, transferables, transferredValues)
	}

	/**
	 * Sends an error response back to the remote endpoint
	 * @param id The ID of the request being responded to
	 * @param error The error message or Error object to send back
	 * @private
	 */
	private sendError(id: string, error: string | Error): void {
		const errorResponse = error instanceof Error ? serializeError(error) : error

		const response: Message<Response<null>> = {
			id,
			method: "",
			args: { error: errorResponse },
			type: "response"
		}
		this.sendMessage(response)
	}

	private sendMessage(
		message: Message,
		transferables: Transferable[] = [],
		transferredValues: unknown[] = []
	): void {
		const encoded = encodeMessage(
			message,
			this.serializationOptions,
			this.supportsTransfer && transferables.length > 0,
			transferredValues
		)

		if (encoded.mode === "string") {
			this.io.write(encoded.data)
		} else {
			this.io.write({
				data: encoded.data,
				transfers: transferables
			})
		}
	}

	// ---------------------------------------------------------------------------
	// Timeout helpers
	// ---------------------------------------------------------------------------

	/** Start a timeout timer for a pending request. No-op if timeout is 0 or Infinity. */
	private startTimeout(messageId: string, method: string): void {
		if (!this.timeout || this.timeout === Infinity) return
		this.pendingTimers[messageId] = setTimeout(() => {
			const pending = this.pendingRequests[messageId]
			if (pending) {
				pending.reject(new RPCTimeoutError(method, this.timeout))
				delete this.pendingRequests[messageId]
				delete this.pendingTimers[messageId]
			}
		}, this.timeout)
	}

	/** Clear the timeout timer for a request that received a response. */
	private clearTimeout(messageId: string): void {
		if (this.pendingTimers[messageId]) {
			clearTimeout(this.pendingTimers[messageId])
			delete this.pendingTimers[messageId]
		}
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
	 * Destroys the RPC channel and underlying IO interface if it's destroyable
	 */
	destroy(): void {
		// Reject all pending requests so callers don't hang forever
		for (const [id, pending] of Object.entries(this.pendingRequests)) {
			pending.reject(new Error("RPC channel destroyed"))
			this.clearTimeout(id)
		}
		this.pendingRequests = {}
		this.pendingTimers = {}

		// Free callbacks
		this.freeCallbacks()

		// Clean up IO adapters
		if (this.io && this.io.destroy) {
			this.io.destroy()
		}
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
