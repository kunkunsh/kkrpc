/**
 * Transport, platform, and codec composition primitives.
 *
 * A `Platform` moves wire values for a runtime primitive, a `Codec` translates
 * between RPC messages and those wire values, and `createTransport()` combines
 * them into the message-level `Transport` consumed by `RPCChannel`. Capability
 * flags describe object-mode, transfer, and broadcast behavior for negotiation.
 */

/** Capabilities available on a message-level transport. */
export interface TransportCapabilities {
	/** The transport can carry JavaScript objects without string serialization. */
	objectMode?: boolean
	/** The transport can forward transferables with sent messages. */
	transfer?: boolean
	/** The transport may deliver messages to more than one peer. */
	broadcast?: boolean
}

/** Capabilities provided by the underlying runtime platform. */
export interface PlatformCapabilities {
	/** The platform wire value is already an object. */
	objectMode?: boolean
	/** The platform accepts transferables when sending. */
	transfer?: boolean
}

/** Capabilities provided by a message codec. */
export interface CodecCapabilities {
	/** The codec preserves transferred values without cloning or serializing them. */
	transfer?: boolean
}

/** Message-level transport used by `RPCChannel`. */
export interface Transport<TMessage> {
	/** Optional transport capabilities used for feature negotiation. */
	capabilities?: TransportCapabilities
	/** Send one message, optionally with transferables when supported. */
	send(message: TMessage, transfers?: Transferable[]): void | Promise<void>
	/** Subscribe to incoming messages and return an unsubscribe callback. */
	subscribe(listener: (message: TMessage) => void): () => void
	/** Close the transport and release runtime resources. */
	close?(): void
}

/** Wire-level runtime primitive used by `createTransport()`. */
export interface Platform<TWire> {
	/** Optional platform capabilities forwarded into the composed transport. */
	capabilities?: PlatformCapabilities
	/** Send one encoded wire value. */
	send(wire: TWire, transfers?: Transferable[]): void | Promise<void>
	/** Subscribe to encoded wire values and return an unsubscribe callback. */
	subscribe(listener: (wire: TWire) => void): () => void
	/** Close the underlying runtime primitive. */
	close?(): void
}

/** Encoder/decoder between RPC messages and platform wire values. */
export interface Codec<TMessage, TWire> {
	/** Optional codec capabilities used during transport composition. */
	capabilities?: CodecCapabilities
	/** Encode an RPC message for the platform. */
	encode(message: TMessage): TWire
	/** Decode one platform wire value into an RPC message. */
	decode(wire: TWire): TMessage
}

/**
 * Compose a wire-level platform and codec into a message-level transport.
 *
 * Transfer support is enabled only when both the platform and codec explicitly
 * advertise `transfer: true`.
 *
 * ```ts
 * import { jsonLineCodec } from "kkrpc/codecs"
 * import { stdioPlatform } from "kkrpc/stdio"
 * import { createTransport } from "kkrpc/transport"
 *
 * const transport = createTransport({ platform: stdioPlatform, codec: jsonLineCodec() })
 * ```
 */
export function createTransport<TMessage, TWire>({
	platform,
	codec
}: {
	platform: Platform<TWire>
	codec: Codec<TMessage, TWire>
}): Transport<TMessage> {
	const supportsTransfer = platform.capabilities?.transfer === true && codec.capabilities?.transfer === true

	return {
		capabilities: {
			objectMode: platform.capabilities?.objectMode,
			transfer: supportsTransfer
		},
		send(message: TMessage, transfers: Transferable[] = []) {
			const wire = codec.encode(message)
			return platform.send(wire, supportsTransfer ? transfers : [])
		},
		subscribe(listener: (message: TMessage) => void) {
			return platform.subscribe((wire) => listener(codec.decode(wire)))
		},
		close() {
			platform.close?.()
		}
	}
}
