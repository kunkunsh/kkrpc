import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

const DEFAULT_IPC_CHANNEL = "kkrpc:message"

export interface ElectronMessageEndpoint {
	send(channel: string, message: RPCMessage): void
	on(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void
	off(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void
}

export interface ElectronTransportOptions {
	endpoint: ElectronMessageEndpoint
	channel?: string
}

export interface ElectronUtilityProcessEndpoint {
	postMessage(message: RPCMessage): void
	on(event: "message", listener: (message: RPCMessage) => void): void
	off(event: "message", listener: (message: RPCMessage) => void): void
	kill?(): unknown
}

export interface ElectronUtilityProcessChildEndpoint {
	postMessage(message: RPCMessage): void
	on(event: "message", listener: (event: { data: RPCMessage }) => void): void
	off(event: "message", listener: (event: { data: RPCMessage }) => void): void
}

interface ElectronUtilityProcessGlobal {
	process?: {
		parentPort?: ElectronUtilityProcessChildEndpoint
	}
}

export interface SecureIpcBridgeOptions {
	ipcRenderer: ElectronMessageEndpoint
	allowedChannels?: string[]
	channelPrefix?: string
}

export interface SecureIpcBridge {
	send(channel: string, message: RPCMessage): void
	on(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void
	off(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void
}

function isChannelAllowed(channel: string, allowedChannels?: string[], channelPrefix?: string): boolean {
	return allowedChannels?.includes(channel) === true || channel.startsWith(channelPrefix ?? "\0")
}

function objectModeCapabilities() {
	return { objectMode: true, transfer: false }
}

function getParentPort(): ElectronUtilityProcessChildEndpoint {
	const parentPort = (globalThis as ElectronUtilityProcessGlobal).process?.parentPort
	if (!parentPort) {
		throw new Error("electronUtilityProcessChildTransport requires process.parentPort")
	}
	return parentPort
}

export function electronIpcTransport(options: ElectronTransportOptions): Transport<RPCMessage> {
	const channel = options.channel ?? DEFAULT_IPC_CHANNEL
	return {
		capabilities: objectModeCapabilities(),
		send(message) {
			options.endpoint.send(channel, message)
		},
		subscribe(listener) {
			const wrapped = (_event: unknown, message: RPCMessage) => listener(message)
			options.endpoint.on(channel, wrapped)
			return () => options.endpoint.off(channel, wrapped)
		}
	}
}

export function electronUtilityProcessTransport(
	endpoint: ElectronUtilityProcessEndpoint
): Transport<RPCMessage> {
	return {
		capabilities: objectModeCapabilities(),
		send(message) {
			endpoint.postMessage(message)
		},
		subscribe(listener) {
			endpoint.on("message", listener)
			return () => endpoint.off("message", listener)
		},
		close() {
			endpoint.kill?.()
		}
	}
}

export function electronUtilityProcessChildTransport(
	endpoint: ElectronUtilityProcessChildEndpoint = getParentPort()
): Transport<RPCMessage> {
	return {
		capabilities: objectModeCapabilities(),
		send(message) {
			endpoint.postMessage(message)
		},
		subscribe(listener) {
			const wrapped = (event: { data: RPCMessage }) => listener(event.data)
			endpoint.on("message", wrapped)
			return () => endpoint.off("message", wrapped)
		}
	}
}

export function createSecureIpcBridge(options: SecureIpcBridgeOptions): SecureIpcBridge {
	const { ipcRenderer, allowedChannels, channelPrefix } = options
	if (!allowedChannels?.length && !channelPrefix) {
		throw new Error("createSecureIpcBridge requires allowedChannels or channelPrefix")
	}

	return {
		send(channel, message) {
			if (isChannelAllowed(channel, allowedChannels, channelPrefix)) ipcRenderer.send(channel, message)
		},
		on(channel, listener) {
			if (isChannelAllowed(channel, allowedChannels, channelPrefix)) ipcRenderer.on(channel, listener)
		},
		off(channel, listener) {
			if (isChannelAllowed(channel, allowedChannels, channelPrefix)) ipcRenderer.off(channel, listener)
		}
	}
}
