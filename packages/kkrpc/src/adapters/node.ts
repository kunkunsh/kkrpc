import { type Buffer } from "node:buffer"
import { Readable, Writable } from "node:stream"
import { type IoCapabilities, type IoInterface, type IoMessage } from "../interface.ts"

export class NodeIo implements IoInterface {
	name = "node-io"
	onMessage?: (message: string) => void | Promise<void>
	private readStream: Readable
	private writeStream: Writable
	private errorHandler: ((error: Error) => void) | null = null
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(readStream: Readable, writeStream: Writable) {
		this.readStream = readStream
		this.writeStream = writeStream

		this.readStream.on("error", (error) => {
			if (this.errorHandler) this.errorHandler(error)
		})

		this.readStream.on("data", (chunk: Buffer) => {
			const decoder = new TextDecoder()
			const message = decoder.decode(chunk)

			if (this.onMessage) {
				this.onMessage(message)
			} else {
				if (this.resolveRead) {
					this.resolveRead(message)
					this.resolveRead = null
				} else {
					this.messageQueue.push(message)
				}
			}
		})

		this.readStream.on("end", () => {
			if (this.resolveRead) {
				this.resolveRead(null)
				this.resolveRead = null
			}
		})
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
			throw new Error("NodeIo only supports string messages")
		}

		return new Promise((resolve, reject) => {
			this.writeStream.write(message, (err) => {
				if (err) reject(err)
				else resolve()
			})
		})
	}
}
