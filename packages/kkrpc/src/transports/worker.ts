/**
 * Web Worker transports for stable kkrpc.
 *
 * Worker transports wrap `postMessage()` endpoints on either side of a worker.
 * They are bidirectional, support callback arguments, and can forward browser
 * transferables when `RPCChannel` passes a transfer list.
 */

import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

interface MessageTargetLike {
	postMessage(message: RPCMessage, transfer?: Transferable[]): void
	addEventListener(type: "message", listener: (event: MessageEvent<RPCMessage>) => void): void
	removeEventListener(type: "message", listener: (event: MessageEvent<RPCMessage>) => void): void
}

interface WorkerScopeLike extends MessageTargetLike {
	close?(): void
}

function createWorkerTransport(target: MessageTargetLike, close?: () => void): Transport<RPCMessage> {
	return {
		capabilities: { objectMode: true, transfer: true },
		send(message: RPCMessage, transfers: Transferable[] = []) {
			if (transfers.length > 0) {
				target.postMessage(message, transfers)
				return
			}
			target.postMessage(message)
		},
		subscribe(listener: (message: RPCMessage) => void) {
			const messageListener = (event: MessageEvent<RPCMessage>) => listener(event.data)
			target.addEventListener("message", messageListener)
			return () => target.removeEventListener("message", messageListener)
		},
		close() {
			close?.()
		}
	}
}

/**
 * Create a transport for the main-thread side of a Web Worker.
 *
 * Closing the transport terminates the worker. Object-mode messages and
 * transferables are forwarded through `worker.postMessage()`.
 */
export function workerTransport(worker: Worker): Transport<RPCMessage> {
	return createWorkerTransport(worker, () => worker.terminate())
}

/**
 * Create a transport for code running inside the worker global scope.
 *
 * By default this wraps `globalThis`; pass a scope-like object for tests. Closing
 * calls `scope.close()` when the worker global exposes it.
 */
export function workerSelfTransport(
	scope: WorkerScopeLike = globalThis as unknown as WorkerScopeLike
): Transport<RPCMessage> {
	return createWorkerTransport(scope, () => scope.close?.())
}
