/**
 * Chrome Extension Adapters for kkrpc
 *
 * This module provides a port-based Chrome extension adapter for
 * bidirectional RPC communication.
 */

import type { DestroyableIoInterface } from "../interface.ts"

const DESTROY_SIGNAL = "__DESTROY__";

/**
 * An I/O interface for kkrpc that uses a chrome.runtime.Port for communication.
 * This can be used in both background scripts and content scripts.
 */
export class ChromePortIO implements DestroyableIoInterface {
  name = "chrome-port-io";
  private messageQueue: string[] = [];
  private resolveRead: ((value: string | null) => void) | null = null;

  constructor(private port: chrome.runtime.Port) {
    this.port.onMessage.addListener(this.handleMessage);
    this.port.onDisconnect.addListener(this.handleDisconnect);
  }

  private handleMessage = (message: any) => {
    // The message can be anything, but kkrpc sends strings.
    if (typeof message !== 'string') {
        console.warn('[ChromePortIO] Received non-string message, ignoring:', message);
        return;
    }

    if (message === DESTROY_SIGNAL) {
      this.destroy();
      return;
    }

    if (this.resolveRead) {
      this.resolveRead(message);
      this.resolveRead = null;
    } else {
      this.messageQueue.push(message);
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

  read(): Promise<string | null> {
    if (this.messageQueue.length > 0) {
      return Promise.resolve(this.messageQueue.shift() ?? null);
    }

    return new Promise((resolve) => {
      this.resolveRead = resolve;
    });
  }

  write(data: string, transfers?: any[]): Promise<void> {
    try {
      // Chrome extension ports don't support transferables in the same way as postMessage
      // but we keep the signature for consistency
      this.port.postMessage(data);
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
