import type { DestroyableIoInterface } from "../interface.ts"

const DESTROY_SIGNAL = "__DESTROY__"

/**
 * Adapter for Chrome extension background script
 * Uses chrome.runtime.onMessage and chrome.tabs.sendMessage for communication
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
 * Adapter for Chrome extension content scripts or popups
 * Uses chrome.runtime.onMessage and chrome.runtime.sendMessage for communication
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
