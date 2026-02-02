// Use global Buffer type for better compatibility with DTS generation
import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"

/**
 * Stdio implementation for Deno
 * Deno doesn't have `process` object, and have a completely different stdio API,
 * This implementation wrap Deno's `Deno.stdin` and `Deno.stdout` to follow StdioInterface
 */
export class DenoIo implements IoInterface {
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private reader: ReadableStreamDefaultReader<Uint8Array>
	name = "deno-io"
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			// Silently ignore error events
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			// Silently ignore error events
		}
	}

	constructor(
		private readStream: ReadableStream<Uint8Array>
		// private writeStream: WritableStream<Uint8Array>
	) {
		this.reader = this.readStream.getReader()
		// const writer = this.writeStream.getWriter()
		// const encoder = new TextEncoder()

		// writer.write(encoder.encode("hello"))
	}

	async read(): Promise<string | null> {
		const { value, done } = await this.reader.read()
		if (done) {
			return null
		}
		const message = value ? new TextDecoder().decode(value) : null
		if (message && this.messageListeners.size > 0) {
			this.messageListeners.forEach((listener) => listener(message))
			return null
		}
		return message
	}

	write(message: string | IoMessage): Promise<void> {
		if (typeof message !== "string") {
			throw new Error("DenoIo only supports string messages")
		}
		const encoder = new TextEncoder()
		const encodedData = encoder.encode(message)
		Deno.stdout.writeSync(encodedData)
		return Promise.resolve()
	}
}
