/**
 * Migration bridge from classic IoInterface adapters to kkrpc/next transports.
 *
 * This module is intentionally separate from `kkrpc/next`: it is for existing
 * user-owned classic IO adapters, not the native transport path for new code.
 */

import type { IoInterface, IoMessage } from "../interface.ts"
import { jsonCodec } from "./codecs.ts"
import type { RPCMessage } from "./protocol.ts"
import type { Transport } from "./transport.ts"

export interface IoTransportOptions {
	closeMode?: "signal-and-destroy" | "signal" | "destroy" | "none"
	onError?: (error: Error) => void
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}

function reportError(error: unknown, onError: ((error: Error) => void) | undefined): void {
	const normalized = toError(error)
	if (onError) {
		onError(normalized)
		return
	}
	queueMicrotask(() => {
		throw normalized
	})
}

function extractString(raw: string | IoMessage): string {
	if (typeof raw === "string") return raw
	if (typeof raw.data === "string") return raw.data
	throw new Error("kkrpc/next/io only supports string IoInterface messages")
}

/** Adapt a classic IoInterface into a JSON-string kkrpc/next transport. */
export function ioTransport(io: IoInterface, options: IoTransportOptions = {}): Transport<RPCMessage> {
	const codec = jsonCodec<RPCMessage>()
	const listeners = new Set<(message: RPCMessage) => void>()
	let closed = false
	let reading = false
	let readStopped = false

	const startReading = () => {
		if (reading || readStopped || closed) return
		reading = true
		void (async () => {
			while (!closed) {
				try {
					const raw = await io.read()
					if (raw === null) {
						readStopped = true
						break
					}
					const wire = extractString(raw)
					if (wire.trim().length === 0) continue
					const message = codec.decode(wire)
					for (const listener of listeners) listener(message)
				} catch (error) {
					reportError(error, options.onError)
					readStopped = true
					break
				}
			}
			reading = false
		})()
	}

	return {
		capabilities: {
			objectMode: false,
			transfer: false,
			broadcast: io.capabilities?.broadcast
		},
		send(message) {
			return io.write(codec.encode(message))
		},
		subscribe(listener) {
			if (closed || readStopped) return () => {}
			listeners.add(listener)
			startReading()
			return () => {
				listeners.delete(listener)
			}
		},
		close() {
			if (closed) return
			closed = true
			readStopped = true
			listeners.clear()
			const closeMode = options.closeMode ?? "signal-and-destroy"
			if (closeMode === "signal" || closeMode === "signal-and-destroy") io.signalDestroy?.()
			if (closeMode === "destroy" || closeMode === "signal-and-destroy") io.destroy?.()
		}
	}
}
