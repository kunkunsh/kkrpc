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

// ============================================================================
// LEGACY ADAPTERS (Deprecated - Use UniversalChromeIO instead)
// ============================================================================
// These adapters are kept for backward compatibility but are deprecated.
// New code should use UniversalChromeIO or the specialized adapters below.

// ============================================================================
// LEGACY UTILITY FUNCTIONS (Deprecated)
// ============================================================================
// These functions are deprecated. Use setupComponentRPC or setupMultiComponentRPC instead.

// ============================================================================
// MULTI-COMPONENT CHROME ADAPTERS
// ============================================================================

/**
 * Component types for Chrome extension RPC communication
 */
export type ChromeComponentType = 'background' | 'content' | 'popup' | 'sidepanel' | 'options' | 'newtab'

/**
 * Universal Chrome extension adapter that can work with any extension component
 * 
 * Uses port-based communication with component-specific connection handling.
 * Supports bidirectional communication between any two extension components.
 * 
 * Features:
 * - Universal component support (popup, sidepanel, options, newtab, content, background)
 * - Port-based communication for reliability
 * - Automatic connection management
 * - Component-specific port naming
 * - Enhanced error handling and logging
 */
export class UniversalChromeIO implements DestroyableIoInterface {
	name = "universal-chrome-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private port: chrome.runtime.Port | null = null
	private isDestroyed = false
	private componentType: ChromeComponentType
	private targetComponentType?: ChromeComponentType
	private tabId?: number // Reserved for future use in content script communication

	/**
	 * Creates a new UniversalChromeIO instance
	 * @param componentType - The type of the current component
	 * @param targetComponentType - The type of the target component (optional for server-side)
	 * @param tabId - Tab ID for content script communication
	 */
	constructor(
		componentType: ChromeComponentType,
		targetComponentType?: ChromeComponentType,
		tabId?: number
	) {
		this.componentType = componentType
		this.targetComponentType = targetComponentType
		this.tabId = tabId

		if (componentType === 'background') {
			this.setupBackgroundListener()
		} else {
			this.connectToTarget()
		}
	}

	private getPortName(): string {
		if (this.targetComponentType) {
			return `kkrpc-${this.componentType}-to-${this.targetComponentType}`
		}
		return `kkrpc-${this.componentType}`
	}

	private setupBackgroundListener() {
		chrome.runtime.onConnect.addListener((port) => {
			const expectedPortName = this.getPortName()
			if (port.name === expectedPortName) {
				this.port = port
				this.port.onMessage.addListener(this.handleMessage)
				this.port.onDisconnect.addListener(() => {
					if (!this.isDestroyed) {
						console.log(`[UniversalChromeIO] ${this.componentType} disconnected`)
					}
					this.port = null
				})
			}
		})
	}

	private connectToTarget() {
		try {
			const portName = this.getPortName()
			this.port = chrome.runtime.connect({ name: portName })

			this.port.onMessage.addListener(this.handleMessage)
			this.port.onDisconnect.addListener(() => {
				this.port = null
				if (!this.isDestroyed) {
					// Attempt to reconnect after a delay
					setTimeout(() => {
						if (!this.isDestroyed) {
							this.connectToTarget()
						}
					}, 1000)
				}
			})
		} catch (error) {
			console.error(`[UniversalChromeIO] Failed to connect from ${this.componentType}:`, error)
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
			throw new Error(`${this.componentType} IO is destroyed or port not connected`)
		}

		try {
			this.port.postMessage(data)
		} catch (error) {
			console.error(`[UniversalChromeIO] Failed to send message from ${this.componentType}:`, error)
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

/**
 * Specialized adapter for popup to background communication
 */
export class PopupToBg extends UniversalChromeIO {
	constructor() {
		super('popup', 'background')
	}
}

/**
 * Specialized adapter for background to popup communication
 */
export class BgToPopup extends UniversalChromeIO {
	constructor() {
		super('background', 'popup')
	}
}

/**
 * Specialized adapter for sidepanel to background communication
 */
export class SidePanelToBg extends UniversalChromeIO {
	constructor() {
		super('sidepanel', 'background')
	}
}

/**
 * Specialized adapter for background to sidepanel communication
 */
export class BgToSidePanel extends UniversalChromeIO {
	constructor() {
		super('background', 'sidepanel')
	}
}

/**
 * Specialized adapter for options to background communication
 */
export class OptionsToBg extends UniversalChromeIO {
	constructor() {
		super('options', 'background')
	}
}

/**
 * Specialized adapter for background to options communication
 */
export class BgToOptions extends UniversalChromeIO {
	constructor() {
		super('background', 'options')
	}
}

/**
 * Specialized adapter for newtab to background communication
 */
export class NewTabToBg extends UniversalChromeIO {
	constructor() {
		super('newtab', 'background')
	}
}

/**
 * Specialized adapter for background to newtab communication
 */
export class BgToNewTab extends UniversalChromeIO {
	constructor() {
		super('background', 'newtab')
	}
}

/**
 * Specialized adapter for popup to content communication (via background)
 */
export class PopupToContent extends UniversalChromeIO {
	constructor(tabId: number) {
		super('popup', 'content', tabId)
	}
}

/**
 * Specialized adapter for sidepanel to content communication (via background)
 */
export class SidePanelToContent extends UniversalChromeIO {
	constructor(tabId: number) {
		super('sidepanel', 'content', tabId)
	}
}

// ============================================================================
// ENHANCED UTILITY FUNCTIONS
// ============================================================================

/**
 * Setup RPC for any Chrome extension component
 * 
 * This is the universal setup function that can be used in any extension component
 * to establish RPC communication with any other component.
 * 
 * @example Background to Popup
 * ```typescript
 * const channels = setupComponentRPC('background', 'popup', backgroundAPI)
 * ```
 * 
 * @example Popup to Background
 * ```typescript
 * const { rpc, remoteAPI } = setupComponentRPC('popup', 'background', popupAPI)
 * ```
 */
export function setupComponentRPC<
	TLocalAPI extends Record<string, any>,
	TRemoteAPI extends Record<string, any>
>(
	componentType: ChromeComponentType,
	targetComponentType: ChromeComponentType,
	localAPI: TLocalAPI,
	tabId?: number
): {
	rpc: RPCChannel<TLocalAPI, TRemoteAPI>
	remoteAPI: TRemoteAPI
} | Map<number, RPCChannel<TLocalAPI, TRemoteAPI>> {
	
	if (componentType === 'background') {
		// Background script - return a map of connections
		const rpcChannels = new Map<number, RPCChannel<TLocalAPI, TRemoteAPI>>()
		
		chrome.runtime.onConnect.addListener((port) => {
			const expectedPortName = `kkrpc-${targetComponentType}-to-background`
			
			if (port.name === expectedPortName) {
				let connectionId: number
				
				if (targetComponentType === 'content' && port.sender?.tab?.id) {
					connectionId = port.sender.tab.id
				} else {
					// For popup, sidepanel, options, newtab - use a general ID
					connectionId = Date.now()
				}

				const io = new UniversalChromeIO('background', targetComponentType)
				const rpc = new RPCChannel<TLocalAPI, TRemoteAPI>(io, {
					expose: localAPI
				})

				rpcChannels.set(connectionId, rpc)

				port.onDisconnect.addListener(() => {
					rpcChannels.delete(connectionId)
					io.destroy()
				})
			}
		})

		return rpcChannels
	} else {
		// Client component - return single connection
		const io = new UniversalChromeIO(componentType, targetComponentType, tabId)
		const rpc = new RPCChannel<TLocalAPI, TRemoteAPI>(io, {
			expose: localAPI
		})

		const remoteAPI = rpc.getAPI()

		return { rpc, remoteAPI }
	}
}

/**
 * Setup multi-component RPC for background script
 * 
 * This function sets up RPC channels for background script to communicate
 * with multiple component types simultaneously.
 * 
 * @example
 * ```typescript
 * const channels = setupMultiComponentRPC(backgroundAPI, ['popup', 'sidepanel', 'content', 'options'])
 * 
 * // Access specific component channels
 * const popupChannel = channels.popup.get('popup-connection-id')
 * const contentChannel = channels.content.get(tabId)
 * ```
 */
export function setupMultiComponentRPC<TLocalAPI extends Record<string, any>>(
	localAPI: TLocalAPI,
	targetComponents: ChromeComponentType[]
): Record<ChromeComponentType, Map<string | number, RPCChannel<TLocalAPI, any>>> {
	const channels: Record<string, Map<string | number, RPCChannel<TLocalAPI, any>>> = {}

	for (const targetComponent of targetComponents) {
		if (targetComponent === 'background') continue // Skip background as source

		channels[targetComponent] = new Map()

		chrome.runtime.onConnect.addListener((port) => {
			const expectedPortName = `kkrpc-${targetComponent}-to-background`
			
			if (port.name === expectedPortName) {
				let connectionId: string | number
				
				if (targetComponent === 'content' && port.sender?.tab?.id) {
					connectionId = port.sender.tab.id
				} else {
					connectionId = `${targetComponent}-${Date.now()}`
				}

				const io = new UniversalChromeIO('background', targetComponent)
				const rpc = new RPCChannel(io, { expose: localAPI })

				channels[targetComponent].set(connectionId, rpc)

				port.onDisconnect.addListener(() => {
					channels[targetComponent].delete(connectionId)
					io.destroy()
				})

				console.log(`[setupMultiComponentRPC] Connected to ${targetComponent} (${connectionId})`)
			}
		})
	}

	return channels as Record<ChromeComponentType, Map<string | number, RPCChannel<TLocalAPI, any>>>
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

// Re-export RPCChannel for convenience
export { RPCChannel }

// Export type for better TypeScript integration
export type { DestroyableIoInterface }