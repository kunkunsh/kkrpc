/**
 * Electron IPC and utility-process transports for stable kkrpc.
 *
 * These helpers use endpoint-like interfaces instead of importing Electron
 * directly, keeping the package entry usable from main, preload, renderer, and
 * tests. Electron IPC is bidirectional and supports callbacks, but these helpers
 * do not expose transferable ownership moves.
 */

import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

const DEFAULT_IPC_CHANNEL = "kkrpc:message"

/** Minimal `ipcMain`/`ipcRenderer`-style endpoint used by `electronIpcTransport()`. */
export interface ElectronMessageEndpoint {
	/** Send one RPC message on the named Electron IPC channel. */
	send(channel: string, message: RPCMessage): void
	/** Attach a listener for the named Electron IPC channel. */
	on(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void
	/** Remove a listener from the named Electron IPC channel. */
	off(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void
}

/** Options for an Electron channel-backed transport. */
export interface ElectronTransportOptions {
	/** Electron endpoint or preload bridge to send and receive through. */
	endpoint: ElectronMessageEndpoint
	/** IPC channel name. Defaults to the kkrpc message channel. */
	channel?: string
}

/** Parent-side Electron utility process endpoint shape. */
export interface ElectronUtilityProcessEndpoint {
	/** Send one RPC message to the utility process. */
	postMessage(message: RPCMessage): void
	/** Attach a utility-process message listener. */
	on(event: "message", listener: (message: RPCMessage) => void): void
	/** Remove a utility-process message listener. */
	off(event: "message", listener: (message: RPCMessage) => void): void
	/** Optionally terminate the utility process when the transport closes. */
	kill?(): unknown
}

/** Child-side Electron utility process endpoint shape. */
export interface ElectronUtilityProcessChildEndpoint {
	/** Send one RPC message to the parent process. */
	postMessage(message: RPCMessage): void
	/** Attach a parent-port message listener. */
	on(event: "message", listener: (event: { data: RPCMessage }) => void): void
	/** Remove a parent-port message listener. */
	off(event: "message", listener: (event: { data: RPCMessage }) => void): void
}

interface ElectronUtilityProcessGlobal {
	process?: {
		parentPort?: ElectronUtilityProcessChildEndpoint
	}
}

/** Options for restricting a preload IPC bridge to approved channels. */
export interface SecureIpcBridgeOptions {
	/** Raw Electron renderer endpoint to wrap. */
	ipcRenderer: ElectronMessageEndpoint
	/** Explicit channel allow-list. */
	allowedChannels?: string[]
	/** Channel prefix that is allowed in addition to explicit channels. */
	channelPrefix?: string
}

/** Narrow IPC bridge surface that can be safely passed to `electronIpcTransport()`. */
export interface SecureIpcBridge {
	/** Send one RPC message if the channel is allowed. */
	send(channel: string, message: RPCMessage): void
	/** Attach a listener if the channel is allowed. */
	on(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void
	/** Remove a listener if the channel is allowed. */
	off(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void
}

function isChannelAllowed(
	channel: string,
	allowedChannels?: string[],
	channelPrefix?: string
): boolean {
	return allowedChannels?.includes(channel) === true || channel.startsWith(channelPrefix ?? "\0")
}

function objectModeCapabilities() {
	return { objectMode: true, transfer: false, remoteRefs: true }
}

function getParentPort(): ElectronUtilityProcessChildEndpoint {
	const parentPort = (globalThis as ElectronUtilityProcessGlobal).process?.parentPort
	if (!parentPort) {
		throw new Error("electronUtilityProcessChildTransport requires process.parentPort")
	}
	return parentPort
}

/**
 * Create a transport over an Electron IPC channel.
 *
 * The endpoint can be an Electron object or a secure preload bridge. The
 * transport is bidirectional, supports callbacks, and unsubscribes its listener
 * when the channel subscription is disposed.
 */
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

/**
 * Create a parent-side transport for an Electron utility process.
 *
 * Closing the transport calls `kill()` when provided. Messages use Electron's
 * object-mode utility-process channel and do not transfer ownership.
 */
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

/**
 * Create a child-side transport for code running inside an Electron utility process.
 *
 * By default this reads `process.parentPort`; pass an endpoint explicitly in
 * tests or nonstandard hosts. The child endpoint is bidirectional and callback-capable.
 */
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

/**
 * Create a channel-filtering IPC bridge for Electron preload scripts.
 *
 * Only channels listed in `allowedChannels` or matching `channelPrefix` are
 * forwarded. Use the returned bridge as the `endpoint` for `electronIpcTransport()`.
 */
export function createSecureIpcBridge(options: SecureIpcBridgeOptions): SecureIpcBridge {
	const { ipcRenderer, allowedChannels, channelPrefix } = options
	if (!allowedChannels?.length && !channelPrefix) {
		throw new Error("createSecureIpcBridge requires allowedChannels or channelPrefix")
	}

	return {
		send(channel, message) {
			if (isChannelAllowed(channel, allowedChannels, channelPrefix))
				ipcRenderer.send(channel, message)
		},
		on(channel, listener) {
			if (isChannelAllowed(channel, allowedChannels, channelPrefix))
				ipcRenderer.on(channel, listener)
		},
		off(channel, listener) {
			if (isChannelAllowed(channel, allowedChannels, channelPrefix))
				ipcRenderer.off(channel, listener)
		}
	}
}
