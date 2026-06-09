/** iframe transports for stable kkrpc. */

import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

const PORT_INIT_SIGNAL = "__KKRPC_PORT_INIT__"
const PORT_ACK_SIGNAL = "__KKRPC_PORT_ACK__"
const PORT_RETRY_DELAY_MS = 25

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

interface PortSignal {
	type: typeof PORT_INIT_SIGNAL | typeof PORT_ACK_SIGNAL
	id: string
}

function isPortSignal(message: unknown, type: PortSignal["type"]): message is PortSignal {
	return (
		typeof message === "object" &&
		message !== null &&
		"type" in message &&
		message.type === type &&
		"id" in message &&
		typeof message.id === "string"
	)
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
	const capabilities = { objectMode: true, transfer: false }
	const queuedMessages: Array<{ message: RPCMessage; transfers: Transferable[] }> = []
	const listeners = new Set<(message: RPCMessage) => void>()
	let unsubscribePort: (() => void) | undefined

	const messageListener = (event: MessageEvent) => {
		if (event.source !== targetWindow || !isPortSignal(event.data, PORT_INIT_SIGNAL)) {
			return
		}
		if (event.ports.length === 0) return

		unsubscribePort?.()
		portTransport?.close?.()
		portTransport = createPortTransport(event.ports[0])
		capabilities.transfer = true
		unsubscribePort = portTransport.subscribe((message) => {
			for (const listener of listeners) listener(message)
		})
		;(event.source as WindowLike).postMessage(
			{ type: PORT_ACK_SIGNAL, id: event.data.id },
			targetOrigin
		)
		for (const item of queuedMessages.splice(0)) portTransport.send(item.message, item.transfers)
	}

	sourceWindow.addEventListener("message", messageListener)

	return {
		capabilities,
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

	const targetOrigin = options.targetOrigin ?? "*"
	const capabilities = { objectMode: true, transfer: false }
	const listeners = new Set<(message: RPCMessage) => void>()
	const queuedMessages: Array<{ message: RPCMessage; transfers: Transferable[] }> = []
	let readyTransport: Transport<RPCMessage> | undefined
	let candidateTransport: Transport<RPCMessage> | undefined
	let candidateUnsubscribe: (() => void) | undefined
	let retryTimer: ReturnType<typeof setTimeout> | undefined
	let activeId = ""

	const promoteCandidate = () => {
		if (!candidateTransport) return
		if (retryTimer) clearTimeout(retryTimer)
		retryTimer = undefined
		readyTransport = candidateTransport
		candidateTransport = undefined
		capabilities.transfer = true
		for (const item of queuedMessages.splice(0)) readyTransport.send(item.message, item.transfers)
	}

	const messageListener = (event: MessageEvent) => {
		if (event.source !== targetWindow || !isPortSignal(event.data, PORT_ACK_SIGNAL)) return
		if (event.data.id !== activeId) return
		promoteCandidate()
	}

	const attemptInit = () => {
		candidateUnsubscribe?.()
		candidateTransport?.close?.()
		const channel = new MessageChannel()
		activeId = `${Date.now()}-${Math.random()}`
		candidateTransport = createPortTransport(channel.port1)
		candidateUnsubscribe = candidateTransport.subscribe((message) => {
			for (const listener of listeners) listener(message)
		})
		targetWindow.postMessage({ type: PORT_INIT_SIGNAL, id: activeId }, targetOrigin, [
			channel.port2
		])
		retryTimer = setTimeout(attemptInit, PORT_RETRY_DELAY_MS)
	}

	sourceWindow.addEventListener("message", messageListener)
	attemptInit()

	return {
		capabilities,
		send(message: RPCMessage, transfers: Transferable[] = []) {
			if (readyTransport) return readyTransport.send(message, transfers)
			queuedMessages.push({ message, transfers })
		},
		subscribe(listener: (message: RPCMessage) => void) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		close() {
			if (retryTimer) clearTimeout(retryTimer)
			candidateUnsubscribe?.()
			candidateTransport?.close?.()
			readyTransport?.close?.()
			sourceWindow.removeEventListener("message", messageListener)
		}
	}
}
