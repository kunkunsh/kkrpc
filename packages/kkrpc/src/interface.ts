/**
 * This file contains the common interface for building a bidirectional communication channel.
 */
import { type Buffer } from "node:buffer"

/**
 * Theoretically, any bidirectional channel with read and write can be used to build a RPC interface.
 */
export interface IoInterface {
	name: string
	read(): Promise<Buffer | Uint8Array | string | null> // Reads input
	write(data: string): Promise<void> // Writes output
}

/**
 * A destroyable IoInterface, mainly for iframe and web worker communication
 * Used for cleaning up resources, e.g. MessageChannel
 */
export interface DestroyableIoInterface extends IoInterface {
	destroy(): void
	signalDestroy(): void
}
