/**
 * iframe parent/child transports for stable kkrpc.
 *
 * The preferred path upgrades to a `MessagePort` through a small
 * `postMessage()` handshake, enabling bidirectional RPC, callback arguments, and
 * transferables. When `MessageChannel` is unavailable, the transport falls back
 * to window-to-window `postMessage()` without transferable support.
 */

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
	onReady?: () => void
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

function isAllowedOrigin(event: MessageEvent, targetOrigin: string): boolean {
	return targetOrigin === "*" || event.origin === targetOrigin
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
				if (!isAllowedOrigin(event, targetOrigin)) return
				listener(event.data)
			}
			sourceWindow.addEventListener("message", messageListener)
			return () => sourceWindow.removeEventListener("message", messageListener)
		}
	}
}

/**
 * Create a transport for the parent-window side of an iframe.
 *
 * Messages sent before the `MessageChannel` handshake completes are queued.
 * Closing removes the window listener, closes the active port, and drops queued
 * state. Callback arguments are supported; transferables are supported after the
 * port handshake succeeds.
 */
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
		// Parent waits for the child to transfer a MessagePort, then acknowledges the active id.
		if (
			event.source !== targetWindow ||
			!isAllowedOrigin(event, targetOrigin) ||
			!isPortSignal(event.data, PORT_INIT_SIGNAL)
		) {
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
		options.onReady?.()
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

/** Resolve with the parent iframe transport after the `MessagePort` handshake has completed. */
export function iframeParentTransportReady(
	targetWindow: Window,
	options: IframeTransportOptions = {}
): Promise<Transport<RPCMessage>> {
	return new Promise((resolve) => {
		const transport = iframeParentTransport(targetWindow, {
			...options,
			onReady: () => resolve(transport)
		})
	})
}

/**
 * Create a transport for code running inside an iframe.
 *
 * The child repeatedly offers a `MessagePort` to its parent until the matching
 * acknowledgement arrives. Calls made before readiness are queued; closing
 * clears retries and closes candidate or ready ports.
 */
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
		options.onReady?.()
	}

	const messageListener = (event: MessageEvent) => {
		if (
			event.source !== targetWindow ||
			!isAllowedOrigin(event, targetOrigin) ||
			!isPortSignal(event.data, PORT_ACK_SIGNAL)
		) {
			return
		}
		if (event.data.id !== activeId) return
		promoteCandidate()
	}

	const attemptInit = () => {
		// Retry until the parent accepts a port; this handles parent listeners attaching late.
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

/** Resolve with the child iframe transport after the `MessagePort` handshake has completed. */
export function iframeChildTransportReady(
	options: IframeTransportOptions = {}
): Promise<Transport<RPCMessage>> {
	return new Promise((resolve) => {
		let ready = false
		let transport: Transport<RPCMessage> | undefined
		transport = iframeChildTransport({
			...options,
			onReady: () => {
				if (transport) {
					resolve(transport)
					return
				}
				ready = true
			}
		})
		if (ready) resolve(transport)
	})
}
