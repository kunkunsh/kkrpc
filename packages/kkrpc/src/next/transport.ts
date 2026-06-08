/**
 * Transport composition primitives for kkrpc/next.
 *
 * A `Platform` moves raw wire values for one runtime primitive, such as a
 * Worker, stdio stream, WebSocket, or in-memory test channel. A `Codec` converts
 * RPC messages to that wire shape. `createTransport()` combines both into the
 * single `Transport<TMessage>` interface consumed by `RPCChannel`.
 *
 * The file has no dependency on `RPCChannel`, validation, middleware, SuperJSON,
 * or runtime adapters. That direction keeps the transport layer reusable and
 * lets optional codecs/transports live behind separate package exports.
 *
 * @example
 * ```ts
 * import { createTransport } from "kkrpc/next/transport"
 * import { jsonLineCodec } from "kkrpc/next/codecs"
 * import type { RPCMessage } from "kkrpc/next"
 *
 * const transport = createTransport<RPCMessage, string>({
 * 	platform: myStringPlatform,
 * 	codec: jsonLineCodec<RPCMessage>()
 * })
 * ```
 */

export interface TransportCapabilities {
	objectMode?: boolean
	transfer?: boolean
	broadcast?: boolean
}

export interface PlatformCapabilities {
	objectMode?: boolean
	transfer?: boolean
}

export interface CodecCapabilities {
	transfer?: boolean
}

export interface Transport<TMessage> {
	capabilities?: TransportCapabilities
	send(message: TMessage, transfers?: Transferable[]): void | Promise<void>
	subscribe(listener: (message: TMessage) => void): () => void
	close?(): void
}

export interface Platform<TWire> {
	capabilities?: PlatformCapabilities
	send(wire: TWire, transfers?: Transferable[]): void | Promise<void>
	subscribe(listener: (wire: TWire) => void): () => void
	close?(): void
}

export interface Codec<TMessage, TWire> {
	capabilities?: CodecCapabilities
	encode(message: TMessage): TWire
	decode(wire: TWire): TMessage
}

/**
 * Combine a runtime platform and serialization codec into a channel transport.
 *
 * Transferable objects are forwarded only when both sides advertise transfer
 * support. If either layer cannot transfer, the channel falls back to normal
 * copy semantics by passing an empty transfer list to the platform.
 *
 * @example
 * ```ts
 * import { createTransport } from "kkrpc/next/transport"
 * import { objectCodec } from "kkrpc/next/codecs"
 *
 * const transport = createTransport({
 * 	platform: objectModePlatform,
 * 	codec: objectCodec()
 * })
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
