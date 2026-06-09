/** iframe transports for stable kkrpc. */

import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

const PORT_INIT_SIGNAL = "__KKRPC_PORT_INIT__"

interface WindowLike {
	parent?: WindowLike
	postMessage(message: unknown, targetOrigin: string, transfers?: Transferable[]): void
	addEventListener(type: "message", listener: (event: MessageEvent) => void): void
	removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
}

interface IframeTransportOptions {
	targetOrigin?: string
	sourceWindow?: WindowLike
}

function createPortTransport(port: MessagePort): Transport<RPCMessage> {
	return {
		capabilities: { objectMode: true, transfer: true },
		send(message: RPCMessage, transfers: Transferable[] = []) {
			if (transfers.length > 0) {
				port.postMessage(message, transfers)
				return
			}
			port.postMessage(message)
		},
		subscribe(listener: (message: RPCMessage) => void) {
			const messageListener = (event: MessageEvent<RPCMessage>) => listener(event.data)
			port.addEventListener("message", messageListener)
			port.start()
			return () => port.removeEventListener("message", messageListener)
		},
		close() {
			port.close()
		}
	}
}

function createWindowTransport({
	targetWindow,
	sourceWindow,
	targetOrigin
}: {
	targetWindow: WindowLike
	sourceWindow: WindowLike
	targetOrigin: string
}): Transport<RPCMessage> {
	return {
		capabilities: { objectMode: true, transfer: false },
		send(message: RPCMessage) {
			targetWindow.postMessage(message, targetOrigin)
		},
		subscribe(listener: (message: RPCMessage) => void) {
			const messageListener = (event: MessageEvent<RPCMessage>) => {
				if (event.source !== targetWindow) return
				listener(event.data)
			}
			sourceWindow.addEventListener("message", messageListener)
			return () => sourceWindow.removeEventListener("message", messageListener)
		}
	}
}

/** Create a transport for the parent-window side of an iframe. */
export function iframeParentTransport(
	targetWindow: Window,
	options: IframeTransportOptions = {}
): Transport<RPCMessage> {
	const sourceWindow = options.sourceWindow ?? (globalThis as unknown as WindowLike)
	const targetOrigin = options.targetOrigin ?? "*"
	if (typeof MessageChannel === "undefined") {
		return createWindowTransport({ targetWindow, sourceWindow, targetOrigin })
	}

	let portTransport: Transport<RPCMessage> | undefined
	const queuedMessages: Array<{ message: RPCMessage; transfers: Transferable[] }> = []
	const listeners = new Set<(message: RPCMessage) => void>()
	let unsubscribePort: (() => void) | undefined

	const messageListener = (event: MessageEvent) => {
		if (
			event.source !== targetWindow ||
			event.data !== PORT_INIT_SIGNAL ||
			event.ports.length === 0
		) {
			return
		}

		portTransport = createPortTransport(event.ports[0])
		unsubscribePort = portTransport.subscribe((message) => {
			for (const listener of listeners) listener(message)
		})
		for (const item of queuedMessages.splice(0)) portTransport.send(item.message, item.transfers)
	}

	sourceWindow.addEventListener("message", messageListener)

	return {
		capabilities: { objectMode: true, transfer: typeof MessageChannel !== "undefined" },
		send(message: RPCMessage, transfers: Transferable[] = []) {
			if (portTransport) return portTransport.send(message, transfers)
			queuedMessages.push({ message, transfers })
		},
		subscribe(listener: (message: RPCMessage) => void) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		close() {
			unsubscribePort?.()
			portTransport?.close?.()
			sourceWindow.removeEventListener("message", messageListener)
		}
	}
}

/** Create a transport for code running inside an iframe. */
export function iframeChildTransport(options: IframeTransportOptions = {}): Transport<RPCMessage> {
	const sourceWindow = options.sourceWindow ?? (globalThis as unknown as WindowLike)
	const targetWindow = sourceWindow.parent
	if (!targetWindow) throw new Error("iframeChildTransport requires a parent window")

	if (typeof MessageChannel === "undefined") {
		return createWindowTransport({
			targetWindow,
			sourceWindow,
			targetOrigin: options.targetOrigin ?? "*"
		})
	}

	const channel = new MessageChannel()
	targetWindow.postMessage(PORT_INIT_SIGNAL, options.targetOrigin ?? "*", [channel.port2])
	return createPortTransport(channel.port1)
}
