import type { DestroyableIoInterface, IoInterface } from "../interface.ts"

interface HTTPClientOptions {
	url: string
	headers?: Record<string, string>
}

/**
 * HTTP Client implementation of IoInterface
 */
export class HTTPClientIO implements IoInterface {
	name = "http-client-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null

	constructor(private options: HTTPClientOptions) {}

	async read(): Promise<string | null> {
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(data: string): Promise<void> {
		try {
			const response = await fetch(this.options.url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...this.options.headers
				},
				body: data
			})

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			const responseText = await response.text()

			if (this.resolveRead) {
				this.resolveRead(responseText)
				this.resolveRead = null
			} else {
				this.messageQueue.push(responseText)
			}
		} catch (error) {
			console.error("HTTP request failed:", error)
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
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private pendingResponses = new Map<string, (response: Response) => void>()

	constructor() {}

	async read(): Promise<string | null> {
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(data: string): Promise<void> {
		// Parse the response to get the request ID
		const response = JSON.parse(data)
		const requestId = response.id

		const resolveResponse = this.pendingResponses.get(requestId)
		if (resolveResponse) {
			resolveResponse(
				new Response(data, {
					headers: { "Content-Type": "application/json" }
				})
			)
			this.pendingResponses.delete(requestId)
		}
	}

	async handleRequest(request: Request): Promise<Response> {
		if (request.method !== "POST") {
			return new Response("Method not allowed", { status: 405 })
		}

		try {
			const message = await request.text()
			// Parse the request to get its ID
			const requestData = JSON.parse(message)
			const requestId = requestData.id

			if (this.resolveRead) {
				this.resolveRead(message)
				this.resolveRead = null
			} else {
				this.messageQueue.push(message)
			}

			return new Promise((resolve) => {
				this.pendingResponses.set(requestId, resolve)
			})
		} catch (error) {
			console.error("RPC processing error:", error)
			return new Response("Internal server error", { status: 500 })
		}
	}
}
