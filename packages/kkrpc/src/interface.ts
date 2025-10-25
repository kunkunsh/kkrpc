/**
 * This file contains the common interface for building a bidirectional communication channel.
 */
// Use global Buffer type instead of node:buffer for better compatibility
// Buffer is available globally in Node.js and can be polyfilled in browsers

/**
 * Theoretically, any bidirectional channel with read and write can be used to build a RPC interface.
 */
export interface IoInterface {
	name: string
	read(): Promise<Uint8Array | string | null> // Reads input
	write(data: string, transfers?: any[]): Promise<void> // Writes output with optional transferables
}

/**
 * A destroyable IoInterface, mainly for iframe and web worker communication
 * Used for cleaning up resources, e.g. MessageChannel
 */
export interface DestroyableIoInterface extends IoInterface {
	destroy(): void
	signalDestroy(): void
}
