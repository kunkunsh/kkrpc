/**
 * Node.js implementation of IoInterface
 * Should also work with Bun
 */
import { type Buffer } from "node:buffer"
import { Readable, Writable } from "node:stream"
import { type IoInterface, type IoMessage, type IoCapabilities } from "../interface.ts"

/**
 * Stdio implementation for Node.js
 * Simply wrap Node.js's `process.stdin` and `process.stdout` to follow StdioInterface
 */
export class NodeIo implements IoInterface {
	name = "node-io"
	private readStream: Readable
	private writeStream: Writable
	private errorHandler: ((error: Error) => void) | null = null
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(readStream: Readable, writeStream: Writable) {
		this.readStream = readStream
		this.writeStream = writeStream

		// Set up persistent listeners
		this.readStream.on("error", (error) => {
			if (this.errorHandler) this.errorHandler(error)
		})
	}

	async read(): Promise<string | null> {
		return new Promise((resolve, reject) => {
			const onData = (chunk: Buffer) => {
				cleanup()
				const decoder = new TextDecoder()
				resolve(decoder.decode(chunk))
			}

			const onEnd = () => {
				cleanup()
				resolve(null)
			}

			const onError = (error: Error) => {
				cleanup()
				reject(error)
			}

			const cleanup = () => {
				this.readStream.removeListener("data", onData)
				this.readStream.removeListener("end", onEnd)
				this.readStream.removeListener("error", onError)
			}

			this.readStream.once("data", onData)
			this.readStream.once("end", onEnd)
			this.readStream.once("error", onError)
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		if (typeof message !== "string") {
			throw new Error("NodeIo only supports string messages")
		}

		return new Promise((resolve, reject) => {
			this.writeStream.write(message, (err) => {
				if (err) reject(err)
				else {
					resolve()
				}
			})
		})
	}
}
