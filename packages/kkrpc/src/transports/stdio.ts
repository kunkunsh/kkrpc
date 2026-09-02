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

/** Minimal Godot APIs used by {@link godotStdioTransport}. */
export interface GodotStdioBinding {
	OS: {
		/** Read one UTF-8 line from stdin. This blocks until input is available. */
		read_string_from_stdin(bufferSize?: number): string
	}
	/** Print one line to process stdout. */
	print(value: string): void
}

/** Options for the GodotJS JSON-line stdio transport. */
export interface GodotStdioTransportOptions {
	/** Observe stdin lines that are not valid RPC frames. */
	onInvalidFrame?(frame: string, error?: unknown): void
	/** Explicit binding for embedded runtimes and tests. Defaults to `require("godot")`. */
	godot?: GodotStdioBinding
	/** Schedule the next blocking read. Defaults to `setTimeout(callback, 0)`. */
	schedule?(callback: () => void): unknown
}

/** Minimal non-blocking pipe returned by Godot's `OS.execute_with_pipe()`. */
export interface GodotChildProcessPipe {
	/** Number of bytes currently available from the child stdout pipe. */
	get_length(): number
	/** Read currently available bytes. */
	get_buffer(length: number): GodotPackedByteArray
	/** Write one line to the child stdin pipe. */
	store_line(line: string): boolean
	/** Flush pending child stdin writes. */
	flush(): void
	/** Close both sides of the child pipe. */
	close(): void
}

/** Minimal packed byte array needed for incremental UTF-8 pipe framing. */
export interface GodotPackedByteArray {
	size(): number
	get(index: number): number
	get_string_from_utf8(): string
}

/** Minimal dictionary returned by Godot's process spawning API. */
export interface GodotChildProcessResult {
	is_empty(): boolean
	get(key: "stdio"): GodotChildProcessPipe | null
	get(key: "pid"): number | null
}

/** Minimal Godot process APIs used by {@link godotChildProcessTransport}. */
export interface GodotChildProcessBinding {
	PackedByteArray: new (bytes: number[]) => GodotPackedByteArray
	OS: {
		execute_with_pipe(path: string, args: string[], blocking: false): GodotChildProcessResult
		is_process_running(pid: number): boolean
		get_process_exit_code(pid: number): number
		kill(pid: number): unknown
	}
}

/** Options for spawning a child process from GodotJS and connecting over stdio. */
export interface GodotChildProcessTransportOptions {
	/** Child executable path. */
	path: string
	/** Child process arguments. */
	args?: string[]
	/** Observe child stdout lines that are not valid RPC frames. */
	onInvalidFrame?(frame: string, error?: unknown): void
	/** Poll interval for the non-blocking stdout pipe. Defaults to 4 ms. */
	pollIntervalMs?: number
	/** Kill a still-running child when the transport closes. Defaults to true. */
	killOnClose?: boolean
	/** Explicit binding for embedded runtimes and tests. Defaults to `require("godot")`. */
	godot?: GodotChildProcessBinding
	/** Override task scheduling in tests or embedded runtimes. */
	schedule?(callback: () => void, delayMs: number): unknown
}

/** A Godot-owned child process transport with its spawned process ID. */
export interface GodotChildProcessTransport extends Transport<RPCMessage> {
	readonly pid: number
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

function getGodotBinding(): GodotStdioBinding {
	const runtimeRequire = (globalThis as { require?: (id: string) => unknown }).require
	if (typeof runtimeRequire !== "function") {
		throw new Error("godotStdioTransport requires the GodotJS CommonJS runtime")
	}
	return runtimeRequire("godot") as GodotStdioBinding
}

function getGodotChildProcessBinding(): GodotChildProcessBinding {
	const runtimeRequire = (globalThis as { require?: (id: string) => unknown }).require
	if (typeof runtimeRequire !== "function") {
		throw new Error("godotChildProcessTransport requires the GodotJS CommonJS runtime")
	}
	return runtimeRequire("godot") as GodotChildProcessBinding
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

/**
 * Create a JSON-line stdio transport for a dedicated GodotJS RPC process.
 *
 * Godot's stdin API blocks the current script thread. The transport schedules
 * each subsequent read as a new task so async RPC handlers and callbacks can run
 * between frames. It is intended for headless/exported worker processes, not a
 * real-time game loop. Closing the parent stdin releases a blocked read.
 */
export function godotStdioTransport(
	options: GodotStdioTransportOptions = {}
): Transport<RPCMessage> {
	const godot = options.godot ?? getGodotBinding()
	const codec = jsonLineCodec<RPCMessage>()
	const schedule = options.schedule ?? ((callback: () => void) => setTimeout(callback, 0))
	let listener: ((message: RPCMessage) => void) | undefined
	let scheduled = false
	let closed = false
	const closeListeners = new Set<(reason?: Error) => void>()
	let remoteClosed = false

	const notifyRemoteClose = (reason?: Error) => {
		if (closed || remoteClosed) return
		remoteClosed = true
		listener = undefined
		for (const closeListener of [...closeListeners]) closeListener(reason)
		closeListeners.clear()
	}

	const deliverFrame = (frame: string) => {
		if (frame.trim().length === 0 || !listener) return
		const wire = `${frame}\n`
		if (!isLikelyRpcFrame(wire)) {
			options.onInvalidFrame?.(wire)
		} else {
			try {
				listener(codec.decode(wire))
			} catch (error) {
				options.onInvalidFrame?.(wire, error)
			}
		}
	}

	const readNext = () => {
		scheduled = false
		if (closed || !listener) return
		let frame: string
		try {
			frame = godot.OS.read_string_from_stdin()
		} catch (error) {
			notifyRemoteClose(toError(error))
			return
		}
		if (closed || !listener) return
		if (frame.length === 0) {
			notifyRemoteClose()
			return
		}
		deliverFrame(frame)
		queueRead()
	}
	const queueRead = () => {
		if (closed || !listener || scheduled) return
		scheduled = true
		schedule(readNext)
	}

	return {
		capabilities: { objectMode: false, transfer: false, remoteRefs: true },
		send(message) {
			if (closed) return Promise.reject(new Error("godotStdioTransport is closed"))
			try {
				const line = codec.encode(message).replace(/\n$/, "")
				godot.print(line)
				return Promise.resolve()
			} catch (error) {
				return Promise.reject(toError(error))
			}
		},
		subscribe(nextListener) {
			if (remoteClosed) return () => {}
			listener = nextListener
			queueRead()
			return () => {
				if (listener === nextListener) listener = undefined
			}
		},
		close() {
			if (closed) return
			closed = true
			listener = undefined
			closeListeners.clear()
		},
		onClose(closeListener) {
			if (remoteClosed) {
				queueMicrotask(() => closeListener())
				return () => {}
			}
			closeListeners.add(closeListener)
			return () => closeListeners.delete(closeListener)
		}
	}
}

/**
 * Spawn a child process from GodotJS and connect to it over JSON-line stdio.
 *
 * The child pipe is non-blocking and polled in short scheduled tasks so Godot's
 * main loop remains responsive. Closing the transport closes the pipe and, by
 * default, terminates a child that is still running.
 */
export function godotChildProcessTransport(
	options: GodotChildProcessTransportOptions
): GodotChildProcessTransport {
	const godot = options.godot ?? getGodotChildProcessBinding()
	const result = godot.OS.execute_with_pipe(options.path, options.args ?? [], false)
	const pipe = result.get("stdio")
	const pid = result.get("pid")
	if (result.is_empty() || !pipe || typeof pid !== "number" || pid <= 0) {
		pipe?.close()
		throw new Error(`godotChildProcessTransport failed to start ${options.path}`)
	}

	const codec = jsonLineCodec<RPCMessage>()
	const schedule =
		options.schedule ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs))
	const pollIntervalMs = options.pollIntervalMs ?? 4
	let listener: ((message: RPCMessage) => void) | undefined
	let frameBytes: number[] = []
	let pollScheduled = false
	let closed = false
	let remoteClosed = false
	const closeListeners = new Set<(reason?: Error) => void>()

	const notifyRemoteClose = (reason?: Error) => {
		if (closed || remoteClosed) return
		remoteClosed = true
		listener = undefined
		pipe.close()
		for (const closeListener of [...closeListeners]) closeListener(reason)
		closeListeners.clear()
	}
	const deliverFrame = (frame: string) => {
		if (frame.trim().length === 0 || !listener) return
		const wire = `${frame}\n`
		if (!isLikelyRpcFrame(wire)) {
			options.onInvalidFrame?.(wire)
			return
		}
		try {
			listener(codec.decode(wire))
		} catch (error) {
			options.onInvalidFrame?.(wire, error)
		}
	}
	const consumeAvailable = () => {
		while (pipe.get_length() > 0) {
			const bytes = pipe.get_buffer(pipe.get_length())
			for (let index = 0; index < bytes.size(); index++) {
				const byte = bytes.get(index)
				if (byte === 10) {
					const frame = new godot.PackedByteArray(frameBytes).get_string_from_utf8()
					deliverFrame(frame.replace(/\r$/, ""))
					frameBytes = []
				} else {
					frameBytes.push(byte)
				}
			}
		}
	}
	const poll = () => {
		pollScheduled = false
		if (closed || remoteClosed || !listener) return
		try {
			consumeAvailable()
			if (!godot.OS.is_process_running(pid)) {
				if (frameBytes.length > 0) {
					const frame = new godot.PackedByteArray(frameBytes).get_string_from_utf8()
					deliverFrame(frame.replace(/\r$/, ""))
					frameBytes = []
				}
				const exitCode = godot.OS.get_process_exit_code(pid)
				notifyRemoteClose(
					exitCode === 0
						? undefined
						: new Error(`Child process ${pid} exited with code ${exitCode}`)
				)
				return
			}
		} catch (error) {
			notifyRemoteClose(toError(error))
			return
		}
		queuePoll()
	}
	const queuePoll = () => {
		if (closed || remoteClosed || !listener || pollScheduled) return
		pollScheduled = true
		schedule(poll, pollIntervalMs)
	}

	return {
		pid,
		capabilities: { objectMode: false, transfer: false, remoteRefs: true },
		send(message) {
			if (closed || remoteClosed) {
				return Promise.reject(new Error("godotChildProcessTransport is closed"))
			}
			try {
				if (!pipe.store_line(codec.encode(message).replace(/\n$/, ""))) {
					return Promise.reject(new Error("godotChildProcessTransport failed to write stdin"))
				}
				pipe.flush()
				return Promise.resolve()
			} catch (error) {
				return Promise.reject(toError(error))
			}
		},
		subscribe(nextListener) {
			if (remoteClosed) return () => {}
			listener = nextListener
			queuePoll()
			return () => {
				if (listener === nextListener) listener = undefined
			}
		},
		close() {
			if (closed) return
			closed = true
			listener = undefined
			closeListeners.clear()
			pipe.close()
			if ((options.killOnClose ?? true) && godot.OS.is_process_running(pid)) godot.OS.kill(pid)
		},
		onClose(closeListener) {
			if (remoteClosed) {
				queueMicrotask(() => closeListener())
				return () => {}
			}
			closeListeners.add(closeListener)
			return () => closeListeners.delete(closeListener)
		}
	}
}
