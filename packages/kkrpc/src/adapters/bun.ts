/**
 * Node.js implementation of IoInterface
 * Should also work with Bun
 */
import { Buffer } from "node:buffer"
import { type IoInterface } from "../interface.ts"

/**
 * Stdio implementation for Bun
 */
export class BunIo implements IoInterface {
	name = "bun-io"
	private readStream: ReadableStream<Uint8Array>
	private reader: ReadableStreamDefaultReader<Uint8Array>

	constructor(readStream: ReadableStream<Uint8Array>) {
		this.readStream = readStream
		// this.writeStream = writeStream

		this.reader = this.readStream.getReader()
	}

	async read(): Promise<Buffer | null> {
		const { value, done } = await this.reader.read()
		if (done) {
			return null // End of input
		}
		return Buffer.from(value)
	}

	async write(data: string): Promise<void> {
		return Bun.write(Bun.stdout, data).then(() => Promise.resolve())
	}
}
