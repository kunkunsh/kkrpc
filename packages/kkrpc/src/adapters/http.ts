import superjson from "superjson"
import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"

interface HTTPClientOptions {
	url: string
	headers?: Record<string, string>
}

/**
 * HTTP Client implementation of IoInterface
 */
export class HTTPClientIO implements IoInterface {
	name = "http-client-io"
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private errorListeners: Set<(error: Error) => void> = new Set()
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(private options: HTTPClientOptions) {}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			this.errorListeners.add(listener as (error: Error) => void)
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			this.errorListeners.delete(listener as (error: Error) => void)
		}
	}

	async read(): Promise<string | null> {
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		if (typeof message !== "string") {
			throw new Error("HTTPClientIO only supports string messages")
		}
		try {
			const response = await fetch(this.options.url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...this.options.headers
				},
				body: message
			})

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			const responseText = await response.text()

			if (this.messageListeners.size > 0) {
				this.messageListeners.forEach((listener) => listener(responseText))
			} else if (this.resolveRead) {
				this.resolveRead(responseText)
				this.resolveRead = null
			} else {
				this.messageQueue.push(responseText)
			}
		} catch (error) {
			this.errorListeners.forEach((listener) => listener(error as Error))
			if (this.resolveRead) {
				this.resolveRead(null)
				this.resolveRead = null
			}
		}
	}
}

/**
 * HTTP Server implementation of IoInterface
 */
export class HTTPServerIO implements IoInterface {
	name = "http-server-io"
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private errorListeners: Set<(error: Error) => void> = new Set()
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private pendingResponses = new Map<string, (response: string) => void>()
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor() {}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			this.errorListeners.add(listener as (error: Error) => void)
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			this.errorListeners.delete(listener as (error: Error) => void)
		}
	}

	async read(): Promise<string | null> {
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		if (typeof message !== "string") {
			throw new Error("HTTPServerIO only supports string messages")
		}
		// Parse the response to get the request ID
		const response = superjson.parse<{ id: string }>(message)
		const requestId = response.id

		const resolveResponse = this.pendingResponses.get(requestId)
		if (resolveResponse) {
			resolveResponse(message)
			this.pendingResponses.delete(requestId)
		}
	}

	async handleRequest(reqData: string): Promise<string> {
		try {
			// Parse the request to get its ID
			const requestData = superjson.parse<{ id: string }>(reqData)
			const requestId = requestData.id

			if (this.messageListeners.size > 0) {
				this.messageListeners.forEach((listener) => listener(reqData))
			} else if (this.resolveRead) {
				this.resolveRead(reqData)
				this.resolveRead = null
			} else {
				this.messageQueue.push(reqData)
			}

			return new Promise((resolve) => {
				this.pendingResponses.set(requestId, resolve)
			})
		} catch (error) {
			this.errorListeners.forEach((listener) => listener(error as Error))
			throw new Error("Internal server error")
		}
	}
}
