import { type Buffer } from "node:buffer"
import { Readable, Writable } from "node:stream"
import { type IoCapabilities, type IoInterface, type IoMessage } from "../interface.ts"

export class NodeIo implements IoInterface {
	name = "node-io"
	private readStream: Readable
	private writeStream: Writable
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private errorListeners: Set<(error: Error) => void> = new Set()
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
			this.errorListeners.forEach((listener) => listener(error))
			if (this.resolveRead) {
				this.resolveRead(null)
				this.resolveRead = null
			}
		})

		this.readStream.on("data", (chunk: Buffer) => {
			const decoder = new TextDecoder()
			const message = decoder.decode(chunk)

			if (this.messageListeners.size > 0) {
				this.messageListeners.forEach((listener) => listener(message))
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
