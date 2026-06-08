/**
 * Stdio transports for kkrpc/next.
 *
 * Stdio is a stream of bytes, so this module splits incoming data by newline
 * and pairs the stream platform with `jsonLineCodec<RPCMessage>()`. The explicit
 * `{ readable, writable }` options support multiple child processes at once and
 * avoid binding every channel to global `process.stdin/stdout`.
 *
 * This module imports Node process globals only in `nodeStdioTransport()`, so
 * browser users do not pull stdio code through the core `kkrpc/next` entry.
 *
 * @example child process pair
 * ```ts
 * import { wrap } from "kkrpc/next"
 * import { stdioJsonTransport } from "kkrpc/next/stdio"
 *
 * const api = wrap<ChildAPI>(stdioJsonTransport({
 * 	readable: child.stdout!,
 * 	writable: child.stdin!
 * }))
 * ```
 */

import { jsonLineCodec } from "./codecs.ts"
import type { RPCMessage } from "./protocol.ts"
import { createTransport } from "./transport.ts"
import type { Platform, Transport } from "./transport.ts"

export interface ReadableLike {
	on(event: "data", listener: (chunk: Uint8Array | string) => void): unknown
	off(event: "data", listener: (chunk: Uint8Array | string) => void): this
}

export interface WritableLike {
	write(chunk: string, callback?: (error?: Error | null) => void): unknown
	end?(): unknown
}

export interface StdioPlatformOptions {
	readable: ReadableLike
	writable: WritableLike
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}

/**
 * Create a string platform from Node-style readable/writable streams.
 *
 * The platform emits one string per newline-delimited frame and writes already
 * framed strings. Pair it with `jsonLineCodec()` through `createTransport()` or
 * use `stdioJsonTransport()` for the standard RPC message transport.
 */
export function stdioPlatform(options: StdioPlatformOptions): Platform<string> {
	const { readable, writable } = options

	return {
		capabilities: { objectMode: false, transfer: false },
		send(wire: string) {
			return new Promise<void>((resolve, reject) => {
				try {
					writable.write(wire, (error) => {
						if (error) {
							reject(toError(error))
							return
						}
						resolve()
					})
				} catch (error) {
					reject(toError(error))
				}
			})
		},
		subscribe(listener: (wire: string) => void) {
			let buffer = ""
			const decoder = new TextDecoder()
			const onData = (chunk: Uint8Array | string) => {
				buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() ?? ""

				for (const line of lines) {
					if (line.trim().length > 0) listener(`${line}\n`)
				}
			}

			readable.on("data", onData)
			return () => readable.off("data", onData)
		},
		close() {
			writable.end?.()
		}
	}
}

/** Create the standard JSON-line stdio transport for RPC messages. */
export function stdioJsonTransport(options: StdioPlatformOptions): Transport<RPCMessage> {
	return createTransport({
		platform: stdioPlatform(options),
		codec: jsonLineCodec<RPCMessage>()
	})
}

/**
 * Create a stdio transport bound to `process.stdin` and `process.stdout`.
 *
 * Use this inside a child process that should expose or consume RPC over its
 * own stdio. For parent processes managing multiple children, prefer
 * `stdioJsonTransport({ readable: child.stdout, writable: child.stdin })`.
 */
export function nodeStdioTransport(
	options: Partial<StdioPlatformOptions> = {}
): Transport<RPCMessage> {
	return stdioJsonTransport({
		readable: options.readable ?? process.stdin,
		writable: options.writable ?? process.stdout
	})
}
