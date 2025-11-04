/**
 * Chrome Extension Adapters for kkrpc
 *
 * This module provides a port-based Chrome extension adapter for
 * bidirectional RPC communication.
 */

import type {
	IoInterface,
	IoMessage,
	IoCapabilities
} from "../interface.ts"

const DESTROY_SIGNAL = "__DESTROY__";

/**
 * An I/O interface for kkrpc that uses a chrome.runtime.Port for communication.
 * This can be used in both background scripts and content scripts.
 */
export class ChromePortIO implements IoInterface {
	name = "chrome-port-io";
	private messageQueue: Array<string | IoMessage> = [];
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null;
	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: false
	};

  constructor(private port: chrome.runtime.Port) {
    this.port.onMessage.addListener(this.handleMessage);
    this.port.onDisconnect.addListener(this.handleDisconnect);
  }

	private handleMessage = (message: any) => {
		if (message === DESTROY_SIGNAL) {
			this.destroy();
			return;
		}

		if (this.resolveRead) {
			this.resolveRead(message as string | IoMessage);
			this.resolveRead = null;
		} else {
			this.messageQueue.push(message as string | IoMessage);
		}
	};

  private handleDisconnect = () => {
    // When the other side disconnects, we signal the destruction
    // of the channel to stop any pending reads.
    if (this.resolveRead) {
        this.resolveRead(null); // End pending read
        this.resolveRead = null;
    }
    this.cleanup();
  }

	read(): Promise<string | IoMessage | null> {
		if (this.messageQueue.length > 0) {
			return Promise.resolve(this.messageQueue.shift() ?? null);
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve;
		});
	}

	write(message: string | IoMessage): Promise<void> {
		try {
			const payload = typeof message === 'string' ? message : message.data;
			this.port.postMessage(payload);
		} catch (error) {
			console.error("[ChromePortIO] Failed to write to port. It might be disconnected.", error);
			this.destroy();
		}
		return Promise.resolve();
	}

  private cleanup = () => {
      this.port.onMessage.removeListener(this.handleMessage);
      this.port.onDisconnect.removeListener(this.handleDisconnect);
  }

  destroy(): void {
    this.signalDestroy();
    this.port.disconnect();
    this.cleanup();
  }

  signalDestroy(): void {
    try {
        this.port.postMessage(DESTROY_SIGNAL);
    } catch (e) {
        // Port might be already closed, ignore.
    }
  }
}
