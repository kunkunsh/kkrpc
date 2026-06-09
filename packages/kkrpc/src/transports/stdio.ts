/** Stdio transports for stable kkrpc. */

import { jsonLineCodec } from "../core/codecs.ts"
import type { RPCMessage } from "../core/protocol.ts"
import { createTransport } from "../core/transport.ts"
import type { Platform, Transport } from "../core/transport.ts"

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

interface NodeProcessLike {
	stdin: ReadableLike
	stdout: WritableLike
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}

function getNodeProcess(): NodeProcessLike {
	const maybeProcess = (globalThis as { process?: NodeProcessLike }).process
	if (!maybeProcess) {
		throw new Error("nodeStdioTransport requires process.stdin and process.stdout")
	}
	return maybeProcess
}

/** Create a string platform from Node-style readable/writable streams. */
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

/** Create a stdio transport bound to Node's process.stdin and process.stdout. */
export function nodeStdioTransport(
	options: Partial<StdioPlatformOptions> = {}
): Transport<RPCMessage> {
	const nodeProcess = getNodeProcess()
	return stdioJsonTransport({
		readable: options.readable ?? nodeProcess.stdin,
		writable: options.writable ?? nodeProcess.stdout
	})
}
