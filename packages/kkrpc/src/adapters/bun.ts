import { type IoCapabilities, type IoInterface, type IoMessage } from "../interface.ts"

export class BunIo implements IoInterface {
	name = "bun-io"
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private readStream: ReadableStream<Uint8Array>
	private reader: ReadableStreamDefaultReader<Uint8Array>
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

	constructor(readStream: ReadableStream<Uint8Array>) {
		this.readStream = readStream
		// this.writeStream = writeStream

		this.reader = this.readStream.getReader()
	}

	async read(): Promise<string | null> {
		const { value, done } = await this.reader.read()
		if (done) {
			return null
		}
		const message = new TextDecoder().decode(value)
		if (this.messageListeners.size > 0) {
			this.messageListeners.forEach((listener) => listener(message))
			return null
		}
		return message
	}

	async write(message: string | IoMessage): Promise<void> {
		if (typeof message !== "string") {
			throw new Error("BunIo only supports string messages")
		}
		return Bun.write(Bun.stdout, message).then(() => Promise.resolve())
	}
}
