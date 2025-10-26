// Use global Buffer type for better compatibility with DTS generation
import type { IoInterface, IoMessage, IoCapabilities } from "../interface.ts"

/**
 * Stdio implementation for Deno
 * Deno doesn't have `process` object, and have a completely different stdio API,
 * This implementation wrap Deno's `Deno.stdin` and `Deno.stdout` to follow StdioInterface
 */
export class DenoIo implements IoInterface {
	private reader: ReadableStreamDefaultReader<Uint8Array>
	name = "deno-io"
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
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
			return null // End of input
		}
		return value ? new TextDecoder().decode(value) : null
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
