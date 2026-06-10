import type { ReadableLike, WritableLike } from "kkrpc/stdio"

export class ReadableStreamLike implements ReadableLike {
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

export function promiseWritable(write: (chunk: string) => unknown): WritableLike {
	return {
		write(chunk, callback) {
			try {
				Promise.resolve(write(chunk)).then(
					() => callback?.(),
					(error) => callback?.(error instanceof Error ? error : new Error(String(error)))
				)
			} catch (error) {
				callback?.(error instanceof Error ? error : new Error(String(error)))
			}
		}
	}
}
