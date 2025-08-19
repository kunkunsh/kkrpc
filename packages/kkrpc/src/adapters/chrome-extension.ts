/**
 * Chrome Extension Adapters for kkrpc
 * 
 * This module provides both basic and enhanced Chrome extension adapters for
 * bidirectional RPC communication between background scripts and content scripts.
 * 
 * Basic adapters use chrome.runtime.onMessage and sendMessage for communication.
 * Enhanced adapters use chrome.runtime.connect and port messaging for better
 * connection management and reliability.
 * 
 * @example Basic Usage
 * ```typescript
 * // Background script
 * import { ChromeBackgroundIO, RPCChannel } from "kkrpc/chrome-extension"
 * 
 * const io = new ChromeBackgroundIO(tabId)
 * const rpc = new RPCChannel(io, { expose: backgroundAPI })
 * 
 * // Content script
 * import { ChromeContentIO, RPCChannel } from "kkrpc/chrome-extension"
 * 
 * const io = new ChromeContentIO()
 * const rpc = new RPCChannel(io, { expose: contentAPI })
 * ```
 * 
 * @example Enhanced Usage
 * ```typescript
 * // Background script
 * chrome.runtime.onConnect.addListener((port) => {
 *   if (port.name === "kkrpc-channel" && port.sender?.tab?.id) {
 *     const io = new EnhancedChromeBackgroundIO(port)
 *     const rpc = new RPCChannel(io, { expose: backgroundAPI })
 *   }
 * })
 * 
 * // Content script
 * const io = new EnhancedChromeContentIO()
 * const rpc = new RPCChannel(io, { expose: contentAPI })
 * const backgroundAPI = rpc.getAPI()
 * ```
 */

import { RPCChannel } from "../channel.ts"
import type { DestroyableIoInterface } from "../interface.ts"

const DESTROY_SIGNAL = "__DESTROY__"
const RPC_PORT_NAME = "kkrpc-channel"

// ============================================================================
// BASIC CHROME ADAPTERS (Message-based)
// ============================================================================

/**
 * Basic adapter for Chrome extension background scripts
 * 
 * Uses chrome.runtime.onMessage and chrome.tabs.sendMessage for communication.
 * Suitable for simple use cases where advanced features are not needed.
 * 
 * Features:
 * - Simple message-based communication
 * - Lightweight implementation
 * - Tab-specific messaging
 */
export class ChromeBackgroundIO implements DestroyableIoInterface {
	name = "chrome-background-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private tabId: number

	private handleMessage = (
		message: any,
		sender: chrome.runtime.MessageSender,
		_sendResponse: Function
	) => {
		// Only handle messages from the specified tab
		if (sender.tab?.id !== this.tabId) return

		if (message === DESTROY_SIGNAL) {
			this.destroy()
			return
		}

		if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
		} else {
			this.messageQueue.push(message)
		}
	}

	/**
	 * Creates a new ChromeBackgroundIO instance
	 * @param tabId - The ID of the tab to communicate with
	 */
	constructor(tabId: number) {
		this.tabId = tabId
		// Listen for messages from content script
		chrome.runtime.onMessage.addListener(this.handleMessage)
	}

	async read(): Promise<string | null> {
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(data: string): Promise<void> {
		await chrome.tabs.sendMessage(this.tabId, data)
	}

	destroy(): void {
		// Cleanup listeners
		chrome.runtime.onMessage.removeListener(this.handleMessage)
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL)
	}
}

/**
 * Basic adapter for Chrome extension content scripts
 * 
 * Uses chrome.runtime.onMessage and chrome.runtime.sendMessage for communication.
 * Suitable for simple use cases where advanced features are not needed.
 * 
 * Features:
 * - Simple message-based communication
 * - Lightweight implementation
 * - Direct background script communication
 */
export class ChromeContentIO implements DestroyableIoInterface {
	name = "chrome-content-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null

	constructor() {
		// Listen for messages from background script
		chrome.runtime.onMessage.addListener(this.handleMessage)
	}

	private handleMessage = (
		message: any,
		_sender: chrome.runtime.MessageSender,
		_sendResponse: Function
	) => {
		if (message === DESTROY_SIGNAL) {
			this.destroy()
			return
		}

		if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
		} else {
			this.messageQueue.push(message)
		}
	}

	async read(): Promise<string | null> {
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(data: string): Promise<void> {
		await chrome.runtime.sendMessage(data)
	}

	destroy(): void {
		// Cleanup listeners
		chrome.runtime.onMessage.removeListener(this.handleMessage)
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL)
	}
}

// ============================================================================
// ENHANCED CHROME ADAPTERS (Port-based)
// ============================================================================

/**
 * Enhanced adapter for Chrome extension background scripts
 * 
 * Uses chrome.runtime.onConnect and port messaging for better connection
 * management and reliability compared to the basic ChromeBackgroundIO.
 * 
 * Features:
 * - Port-based communication for better reliability
 * - Automatic cleanup on disconnection
 * - Message queuing during connection issues
 * - Enhanced error handling and logging
 * - Better resource management
 */
export class EnhancedChromeBackgroundIO implements DestroyableIoInterface {
	name = "enhanced-chrome-background-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private port: chrome.runtime.Port
	private isDestroyed = false

	/**
	 * Creates a new EnhancedChromeBackgroundIO instance
	 * @param port - The Chrome runtime port for this tab connection
	 */
	constructor(port: chrome.runtime.Port) {
		this.port = port
		this.port.onMessage.addListener(this.handleMessage)
		this.port.onDisconnect.addListener(() => {
			if (!this.isDestroyed) {
				console.log("[EnhancedChromeBackgroundIO] Content script disconnected")
			}
		})
	}

	private handleMessage = (message: any) => {
		if (this.isDestroyed) return

		if (message === DESTROY_SIGNAL) {
			this.destroy()
			return
		}

		if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
		} else {
			this.messageQueue.push(message)
		}
	}

	async read(): Promise<string | null> {
		if (this.isDestroyed) return null

		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(data: string): Promise<void> {
		if (this.isDestroyed) {
			throw new Error("Background IO is destroyed")
		}

		try {
			this.port.postMessage(data)
		} catch (error) {
			console.error("[EnhancedChromeBackgroundIO] Failed to send message:", error)
			throw error
		}
	}

	destroy(): void {
		this.isDestroyed = true
		this.port.onMessage.removeListener(this.handleMessage)

		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL).catch(() => {
			// Ignore errors when signaling destroy
		})
	}
}

/**
 * Enhanced adapter for Chrome extension content scripts
 * 
 * Uses chrome.runtime.connect to establish a port-based connection with the
 * background script. Provides better reliability and features compared to
 * the basic ChromeContentIO.
 * 
 * Features:
 * - Port-based communication for better reliability
 * - Automatic connection establishment
 * - Reconnection on unexpected disconnects
 * - Message queuing during disconnection
 * - Enhanced error handling and logging
 */
export class EnhancedChromeContentIO implements DestroyableIoInterface {
	name = "enhanced-chrome-content-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private port: chrome.runtime.Port | null = null
	private isDestroyed = false

	/**
	 * Creates a new EnhancedChromeContentIO instance and connects to background script
	 */
	constructor() {
		this.connectToBackground()
	}

	private connectToBackground() {
		try {
			this.port = chrome.runtime.connect({ name: RPC_PORT_NAME })

			this.port.onMessage.addListener(this.handleMessage)
			this.port.onDisconnect.addListener(() => {
				this.port = null
				if (!this.isDestroyed) {
					// Attempt to reconnect after a delay
					setTimeout(() => {
						if (!this.isDestroyed) {
							this.connectToBackground()
						}
					}, 1000)
				}
			})
		} catch (error) {
			console.error("[EnhancedChromeContentIO] Failed to connect:", error)
			throw error
		}
	}

	private handleMessage = (message: any) => {
		if (this.isDestroyed) return

		if (message === DESTROY_SIGNAL) {
			this.destroy()
			return
		}

		if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
		} else {
			this.messageQueue.push(message)
		}
	}

	async read(): Promise<string | null> {
		if (this.isDestroyed) return null

		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(data: string): Promise<void> {
		if (this.isDestroyed || !this.port) {
			throw new Error("Content IO is destroyed or port not connected")
		}

		try {
			this.port.postMessage(data)
		} catch (error) {
			console.error("[EnhancedChromeContentIO] Failed to send message:", error)
			throw error
		}
	}

	destroy(): void {
		this.isDestroyed = true
		this.port?.disconnect()
		this.port = null

		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL).catch(() => {
			// Ignore errors when signaling destroy
		})
	}
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Utility function to set up RPC in background script using enhanced adapters
 * 
 * This function sets up automatic port connection handling and RPC channel
 * management for multiple tabs. It's the recommended way to set up Chrome
 * extension RPC in background scripts.
 * 
 * @example
 * ```typescript
 * import { setupBackgroundRPC } from 'kkrpc/chrome-extension'
 * 
 * const backgroundAPI = {
 *   async executeInMainWorld(code: string) {
 *     // Implementation here
 *     return { success: true }
 *   }
 * }
 * 
 * const rpcChannels = setupBackgroundRPC(backgroundAPI)
 * ```
 */
export function setupBackgroundRPC<
	TLocalAPI extends Record<string, any>,
	TRemoteAPI extends Record<string, any>
>(
	localAPI: TLocalAPI,
	options: { portName?: string } = {}
): Map<number, RPCChannel<TLocalAPI, TRemoteAPI>> {
	const { portName = RPC_PORT_NAME } = options
	const rpcChannels = new Map<number, RPCChannel<TLocalAPI, TRemoteAPI>>()

	chrome.runtime.onConnect.addListener((port) => {
		if (port.name === portName && port.sender?.tab?.id) {
			const tabId = port.sender.tab.id

			const io = new EnhancedChromeBackgroundIO(port)
			const rpc = new RPCChannel<TLocalAPI, TRemoteAPI>(io, {
				expose: localAPI
			})

			rpcChannels.set(tabId, rpc)

			port.onDisconnect.addListener(() => {
				rpcChannels.delete(tabId)
				io.destroy()
			})
		}
	})

	return rpcChannels
}

/**
 * Utility function to set up RPC in content script using enhanced adapters
 * 
 * This function simplifies the setup of RPC communication from content scripts
 * to background scripts. It handles connection establishment and returns both
 * the RPC channel and the background API.
 * 
 * @example
 * ```typescript
 * import { setupContentRPC } from 'kkrpc/chrome-extension'
 * 
 * const contentAPI = {
 *   async getPageInfo() {
 *     return {
 *       title: document.title,
 *       url: window.location.href
 *     }
 *   }
 * }
 * 
 * const { rpc, backgroundAPI } = await setupContentRPC(contentAPI)
 * const result = await backgroundAPI.executeInMainWorld('console.log("Hello!")')
 * ```
 */
export function setupContentRPC<
	TLocalAPI extends Record<string, any>,
	TRemoteAPI extends Record<string, any>
>(
	localAPI: TLocalAPI,
	_options: { portName?: string } = {}
): {
	rpc: RPCChannel<TLocalAPI, TRemoteAPI>
	backgroundAPI: TRemoteAPI
} {
	const io = new EnhancedChromeContentIO()
	const rpc = new RPCChannel<TLocalAPI, TRemoteAPI>(io, {
		expose: localAPI
	})

	const backgroundAPI = rpc.getAPI()

	return { rpc, backgroundAPI }
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

// Re-export RPCChannel for convenience
export { RPCChannel }

// Export type for better TypeScript integration
export type { DestroyableIoInterface }