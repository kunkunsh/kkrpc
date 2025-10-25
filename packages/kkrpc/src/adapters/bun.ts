/**
 * Node.js implementation of IoInterface
 * Should also work with Bun
 */
// Use Uint8Array instead of Buffer for better compatibility
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

	async read(): Promise<Uint8Array | null> {
		const { value, done } = await this.reader.read()
		if (done) {
			return null // End of input
		}
		return value
	}

	async write(data: string, transfers?: any[]): Promise<void> {
		// Bun stdout doesn't support transferables, so we ignore them
		return Bun.write(Bun.stdout, data).then(() => Promise.resolve())
	}
}
