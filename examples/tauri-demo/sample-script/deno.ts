import { RPCChannel, stdioJsonTransport } from "kkrpc/deno"
import { apiMethods } from "./api.js"

class ReadableStreamLike {
	private listeners = new Set<(chunk: Uint8Array | string) => void>()

	constructor(stream: ReadableStream<Uint8Array>) {
		void this.pump(stream)
	}

	on(event: "data", listener: (chunk: Uint8Array | string) => void): unknown {
		if (event === "data") this.listeners.add(listener)
		return undefined
	}

	off(event: "data", listener: (chunk: Uint8Array | string) => void): this {
		if (event === "data") this.listeners.delete(listener)
		return this
	}

	private async pump(stream: ReadableStream<Uint8Array>): Promise<void> {
		const reader = stream.getReader()
		try {
			while (true) {
				const result = await reader.read()
				if (result.done) return
				for (const listener of this.listeners) listener(result.value)
			}
		} finally {
			reader.releaseLock()
		}
	}
}

const encoder = new TextEncoder()

const stdio = stdioJsonTransport({
	readable: new ReadableStreamLike(Deno.stdin.readable),
	writable: {
		write(chunk, callback) {
			Deno.stdout.write(encoder.encode(chunk)).then(
				() => callback?.(),
				(error) => callback?.(error instanceof Error ? error : new Error(String(error)))
			)
		}
	}
})
const child = new RPCChannel(stdio, { expose: apiMethods })
