/**
 * Common IO abstractions used by kkrpc adapters.
 * Theoretically, any bidirectional channel that fits this interface can back an RPC channel.
 */
import type { WireEnvelope } from "./serialization.ts"

/**
 * Capabilities exposed by an IO adapter.
 * These capabilities are used by RPCChannel to decide whether structured clone
 * messaging and transferable objects can be used.
 */
export interface IoCapabilities {
	/** Adapter can send/receive structured clone objects (e.g. postMessage based transports). */
	structuredClone?: boolean
	/** Adapter can transfer transferable objects without copying. */
	transfer?: boolean
	/** Optional list of known transferable object types supported by the adapter. */
	transferTypes?: string[]
}

/**
 * Message container used when adapters provide structured clone data.
 */
export interface IoMessage {
	data: string | WireEnvelope
	transfers?: Transferable[]
}

/**
 * The generic IO contract used throughout the library.
 * Implementations can choose to support string-only messaging or structured clone objects.
 */
export interface IoInterface {
	name: string
	read(): Promise<string | IoMessage | null>
	write(message: string | IoMessage): Promise<void>
	capabilities?: IoCapabilities
}

/**
 * A destroyable IoInterface, mainly for iframe and web worker communication.
 * Used for cleaning up resources, e.g. MessageChannel.
 */
export interface DestroyableIoInterface extends IoInterface {
	destroy(): void
	signalDestroy(): void
}
