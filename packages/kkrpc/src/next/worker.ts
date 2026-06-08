/**
 * Worker transports for kkrpc/next.
 *
 * Worker messaging already carries structured objects and transferable values,
 * so this module exposes object-mode `Transport<RPCMessage>` instances directly
 * instead of going through a string codec. Keeping Worker support in its own
 * entry point means `kkrpc/next` does not import browser-specific globals.
 *
 * @example main thread
 * ```ts
 * import { wrap } from "kkrpc/next"
 * import { workerTransport } from "kkrpc/next/worker"
 *
 * const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
 * const api = wrap<MyWorkerAPI>(workerTransport(worker))
 * ```
 *
 * @example worker thread
 * ```ts
 * import { expose } from "kkrpc/next"
 * import { workerSelfTransport } from "kkrpc/next/worker"
 *
 * expose({ ping: () => "pong" }, workerSelfTransport())
 * ```
 */

import type { RPCMessage } from "./protocol.ts"
import type { Transport } from "./transport.ts"

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
