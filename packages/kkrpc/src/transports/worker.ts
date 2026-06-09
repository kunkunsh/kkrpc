/** Worker transports for stable kkrpc. */

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

/** Create a transport for the main-thread side of a Web Worker. */
export function workerTransport(worker: Worker): Transport<RPCMessage> {
	return createWorkerTransport(worker, () => worker.terminate())
}

/** Create a transport for code running inside the worker global scope. */
export function workerSelfTransport(
	scope: WorkerScopeLike = globalThis as unknown as WorkerScopeLike
): Transport<RPCMessage> {
	return createWorkerTransport(scope, () => scope.close?.())
}
