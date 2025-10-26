import { type IoInterface, type IoMessage, type IoCapabilities } from "../interface.ts"

export class BunIo implements IoInterface {
	name = "bun-io"
	private readStream: ReadableStream<Uint8Array>
	private reader: ReadableStreamDefaultReader<Uint8Array>
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(readStream: ReadableStream<Uint8Array>) {
		this.readStream = readStream
		// this.writeStream = writeStream

		this.reader = this.readStream.getReader()
	}

	async read(): Promise<string | null> {
		const { value, done } = await this.reader.read()
		if (done) {
			return null // End of input
		}
		return new TextDecoder().decode(value)
	}

	async write(message: string | IoMessage): Promise<void> {
		if (typeof message !== "string") {
			throw new Error("BunIo only supports string messages")
		}
		return Bun.write(Bun.stdout, message).then(() => Promise.resolve())
	}
}
