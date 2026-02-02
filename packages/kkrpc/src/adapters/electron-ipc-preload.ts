/**
 * Minimal interface for Electron's ipcRenderer.
 * This avoids importing from "electron" directly, making kkrpc compatible
 * with any Electron version without adding it as a dependency.
 */
export interface IpcRendererInterface {
	send(channel: string, ...args: unknown[]): void
	on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
	off(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
}

export interface SecureIpcBridgeOptions {
	/** The ipcRenderer instance from Electron */
	ipcRenderer: IpcRendererInterface
	/** List of specific channels to allow (whitelist) */
	allowedChannels?: string[]
	/** Channel prefix to allow (e.g., "kkrpc-" allows all channels starting with it) */
	channelPrefix?: string
}

function isChannelAllowed(
	channel: string,
	allowedChannels?: string[],
	channelPrefix?: string
): boolean {
	if (allowedChannels && allowedChannels.includes(channel)) {
		return true
	}
	if (channelPrefix && channel.startsWith(channelPrefix)) {
		return true
	}
	return false
}

/**
 * Creates a secure IPC bridge for Electron renderer process.
 * Returns a wrapped ipcRenderer that only allows communication on whitelisted channels.
 *
 * @example
 * // preload.ts - Import electron yourself
 * import { contextBridge, ipcRenderer } from "electron"
 * import { createSecureIpcBridge } from "kkrpc/electron-ipc"
 *
 * const securedIpcRenderer = createSecureIpcBridge({
 *   ipcRenderer,
 *   channelPrefix: "kkrpc-"
 * })
 *
 * contextBridge.exposeInMainWorld("electron", {
 *   ipcRenderer: securedIpcRenderer
 * })
 */
export function createSecureIpcBridge(options: SecureIpcBridgeOptions) {
	const { ipcRenderer, allowedChannels, channelPrefix } = options

	if (!ipcRenderer) {
		throw new Error("createSecureIpcBridge requires ipcRenderer parameter")
	}

	if (!allowedChannels?.length && !channelPrefix) {
		throw new Error(
			"createSecureIpcBridge requires at least one of: allowedChannels or channelPrefix"
		)
	}

	const isAllowed = (channel: string) => isChannelAllowed(channel, allowedChannels, channelPrefix)

	return {
		send(channel: string, ...args: unknown[]) {
			if (!isAllowed(channel)) {
				console.warn(`[kkrpc] Blocked IPC send to channel: ${channel}`)
				return
			}
			ipcRenderer.send(channel, ...args)
		},
		on(channel: string, listener: (event: unknown, ...args: unknown[]) => void) {
			if (!isAllowed(channel)) {
				console.warn(`[kkrpc] Blocked IPC listener on channel: ${channel}`)
				return
			}
			ipcRenderer.on(channel, listener)
		},
		off(channel: string, listener: (event: unknown, ...args: unknown[]) => void) {
			if (!isAllowed(channel)) {
				return
			}
			ipcRenderer.off(channel, listener)
		}
	}
}
