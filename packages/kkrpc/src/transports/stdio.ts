/**
 * JSON-line stdio transports for stable kkrpc.
 *
 * Stdio transports wrap Node-style readable and writable streams. They are
 * bidirectional when both processes wire stdin/stdout to each other, support
 * callback arguments, and use newline-delimited JSON without transferables.
 */

import { jsonLineCodec } from "../core/codecs.ts"
import type { RPCMessage } from "../core/protocol.ts"
import type { Platform, Transport } from "../core/transport.ts"

/** Minimal readable stream interface used by stdio transports. */
export interface ReadableLike {
	/** Attach a data listener for byte or string chunks. */
	on(event: "data", listener: (chunk: Uint8Array | string) => void): unknown
	/** Remove a previously attached data listener. */
	off(event: "data", listener: (chunk: Uint8Array | string) => void): this
}

/** Minimal writable stream interface used by stdio transports. */
export interface WritableLike {
	/** Write one encoded frame. */
	write(chunk: string, callback?: (error?: Error | null) => void): unknown
	/** Optionally end the writable side when the transport closes. */
	end?(): unknown
}

/**
 * Node-style stream lifecycle event source used to report connection close.
 *
 * Usually the same object as `readable`. When provided, the platform and
 * transport expose `onClose`: `"error"` reports the error, `"end"`/`"close"`
 * report a clean close. Left optional so the minimal `ReadableLike` contract
 * (and consumers like the Tauri transport) stays unchanged.
 */
export interface StreamLifecycleLike {
	/** Attach a lifecycle listener. */
	on(event: "close" | "end" | "error", listener: (...args: unknown[]) => void): unknown
	/** Remove a lifecycle listener. */
	off?(event: "close" | "end" | "error", listener: (...args: unknown[]) => void): unknown
}

/** Streams to compose into a stdio platform. */
export interface StdioPlatformOptions {
	/** Readable stream that emits incoming JSON-line data. */
	readable: ReadableLike
	/** Writable stream that receives outgoing JSON-line data. */
	writable: WritableLike
	/** Optional lifecycle event source enabling `onClose` on the transport. */
	lifecycle?: StreamLifecycleLike
}

/** Options for the standard JSON-line RPC stdio transport. */
export interface StdioJsonTransportOptions extends StdioPlatformOptions {
	/** Observe stdout lines that are not valid RPC frames. */
	onInvalidFrame?(frame: string, error?: unknown): void
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

/**
 * Create a string platform from Node-style readable/writable streams.
 *
 * The platform emits complete newline-delimited frames, writes string frames to
 * the provided writable, and closes by calling `writable.end()` when available.
 */
export function stdioPlatform(options: StdioPlatformOptions): Platform<string> {
	const { readable, writable, lifecycle } = options

	// Connection-close notification, wired only when a lifecycle source is provided.
	const closeListeners = new Set<(reason?: Error) => void>()
	let closeNotified = false
	let closeReason: Error | undefined
	let detachLifecycle: (() => void) | undefined

	const notifyClose = (reason?: Error) => {
		if (closeNotified) return
		closeNotified = true
		closeReason = reason
		detachLifecycle?.()
		detachLifecycle = undefined
		for (const listener of [...closeListeners]) listener(reason)
		closeListeners.clear()
	}

	if (lifecycle) {
		const onError = (error: unknown) =>
			notifyClose(error instanceof Error ? error : new Error(String(error ?? "stream error")))
		const onEnd = () => notifyClose(undefined)
		lifecycle.on("error", onError)
		lifecycle.on("end", onEnd)
		lifecycle.on("close", onEnd)
		detachLifecycle = () => {
			lifecycle.off?.("error", onError)
			lifecycle.off?.("end", onEnd)
			lifecycle.off?.("close", onEnd)
		}
	}

	const platform: Platform<string> = {
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
			// Local close is intentional teardown; do not fire onClose.
			closeNotified = true
			detachLifecycle?.()
			detachLifecycle = undefined
			closeListeners.clear()
			writable.end?.()
		}
	}
	if (lifecycle) {
		platform.onClose = (listener) => {
			if (closeNotified) {
				const reason = closeReason
				queueMicrotask(() => listener(reason))
				return () => {}
			}
			closeListeners.add(listener)
			return () => closeListeners.delete(listener)
		}
	}
	return platform
}

function isLikelyRpcFrame(wire: string): boolean {
	return wire.trimStart().startsWith("{")
}

/**
 * Create the standard JSON-line stdio transport for RPC messages.
 *
 * This composes `stdioPlatform()` with `jsonLineCodec()`. It is bidirectional
 * when paired with another process and supports callbacks, but not transferables.
 */
export function stdioJsonTransport(options: StdioJsonTransportOptions): Transport<RPCMessage> {
	const platform = stdioPlatform(options)
	const codec = jsonLineCodec<RPCMessage>()

	const transport: Transport<RPCMessage> = {
		capabilities: { objectMode: false, transfer: false, remoteRefs: true },
		send(message: RPCMessage) {
			return platform.send(codec.encode(message), [])
		},
		subscribe(listener: (message: RPCMessage) => void) {
			return platform.subscribe((wire) => {
				if (!isLikelyRpcFrame(wire)) {
					options.onInvalidFrame?.(wire)
					return
				}
				try {
					listener(codec.decode(wire))
				} catch (error) {
					options.onInvalidFrame?.(wire, error)
				}
			})
		},
		close() {
			platform.close?.()
		}
	}
	// Forward conditionally so absence stays a reliable capability signal.
	if (platform.onClose) transport.onClose = (listener) => platform.onClose!(listener)
	return transport
}

/**
 * Create a stdio transport bound to Node's `process.stdin` and `process.stdout`.
 *
 * Pass explicit streams in tests or embedded runtimes. Closing the transport ends
 * the writable stream when the stream exposes `end()`.
 */
export function nodeStdioTransport(
	options: Partial<StdioPlatformOptions> = {}
): Transport<RPCMessage> {
	const nodeProcess = getNodeProcess()
	const usingDefaultReadable = options.readable === undefined
	const readable = options.readable ?? nodeProcess.stdin
	return stdioJsonTransport({
		readable,
		writable: options.writable ?? nodeProcess.stdout,
		// Real Node streams emit end/close/error, so auto-wire lifecycle when using the
		// default process.stdin. Custom readables must opt in via `options.lifecycle`.
		lifecycle:
			options.lifecycle ??
			(usingDefaultReadable ? (readable as unknown as StreamLifecycleLike) : undefined)
	})
}
