/**
 * Transport, platform, and codec composition primitives.
 *
 * A `Platform` moves wire values for a runtime primitive, a `Codec` translates
 * between RPC messages and those wire values, and `createTransport()` combines
 * them into the message-level `Transport` consumed by `RPCChannel`. Capability
 * flags describe object-mode, transfer, and broadcast behavior for negotiation.
 */

/**
 * Capabilities available on a message-level transport.
 *
 * `transfer` and `remoteRefs` drive behavior: `RPCChannel` checks `transfer`
 * before forwarding transferables, and `RemoteReferenceRPCChannel` checks
 * `remoteRefs` before allowing by-reference traffic. `objectMode` and `broadcast`
 * are currently informational — the core does not branch on them — but transports
 * should still report them truthfully so applications can inspect them.
 */
export interface TransportCapabilities {
	/**
	 * The transport carries JavaScript objects without string serialization
	 * (structured-clone-grade), so non-JSON values such as `Date`, `Map`, and
	 * `undefined` survive. Transports that JSON-serialize should report `false`.
	 * Informational: the core does not branch on this flag.
	 */
	objectMode?: boolean
	/** The transport can forward transferables with sent messages. */
	transfer?: boolean
	/** The transport may deliver messages to more than one peer. Informational. */
	broadcast?: boolean
	/** The transport can carry bidirectional remote-reference request traffic. */
	remoteRefs?: boolean
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
	/**
	 * Optionally register a listener invoked at most once when the transport
	 * permanently stops delivering messages because the connection dropped (remote
	 * close or network error). It is NOT invoked for a local `close()`. `reason` is
	 * an `Error` for abnormal termination and `undefined` for a clean remote close.
	 * Registering after the transport has already closed invokes the listener
	 * asynchronously with the recorded reason. Returns an unsubscribe function.
	 *
	 * When present, `RPCChannel` uses it to reject pending requests immediately
	 * instead of waiting for their timeouts. Transports that omit it behave as
	 * before: pending requests resolve, time out, or wait for `destroy()`.
	 */
	onClose?(listener: (reason?: Error) => void): () => void
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
	/** Optional connection-close notification; forwarded into the composed transport's `onClose`. Same contract as `Transport.onClose`. */
	onClose?(listener: (reason?: Error) => void): () => void
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
 * advertise `transfer: true`; overrides can only downgrade transfer to `false`,
 * not upgrade an unsafe platform/codec pair. Other message-level capability
 * overrides can advertise behavior that is not owned by the platform/codec pair,
 * such as point-to-point remote-reference support.
 *
 * ```ts
 * import { jsonLineCodec } from "kkrpc/codecs"
 * import { stdioPlatform } from "kkrpc/stdio"
 * import { createTransport } from "kkrpc/transport"
 *
 * const transport = createTransport({
 * 	platform: stdioPlatform({ readable, writable }),
 * 	codec: jsonLineCodec()
 * })
 * ```
 */
export function createTransport<TMessage, TWire>({
	platform,
	codec,
	capabilities,
	onInvalidFrame
}: {
	platform: Platform<TWire>
	codec: Codec<TMessage, TWire>
	capabilities?: TransportCapabilities
	/**
	 * Observe wire values that `codec.decode()` could not parse. When provided,
	 * decode errors are reported here and the frame is dropped instead of throwing
	 * into the platform's receive loop. This matters for transports that may carry
	 * non-kkrpc or malformed frames. Without it, decode errors propagate as before.
	 */
	onInvalidFrame?: (wire: TWire, error: unknown) => void
}): Transport<TMessage> {
	const supportsTransfer =
		platform.capabilities?.transfer === true && codec.capabilities?.transfer === true
	const forwardsTransfer = supportsTransfer && capabilities?.transfer !== false

	const transport: Transport<TMessage> = {
		capabilities: {
			objectMode: capabilities?.objectMode ?? platform.capabilities?.objectMode,
			transfer: forwardsTransfer,
			broadcast: capabilities?.broadcast,
			remoteRefs: capabilities?.remoteRefs
		},
		send(message: TMessage, transfers: Transferable[] = []) {
			const wire = codec.encode(message)
			return platform.send(wire, forwardsTransfer ? transfers : [])
		},
		subscribe(listener: (message: TMessage) => void) {
			return platform.subscribe((wire) => {
				if (!onInvalidFrame) {
					listener(codec.decode(wire))
					return
				}
				let message: TMessage
				try {
					message = codec.decode(wire)
				} catch (error) {
					onInvalidFrame(wire, error)
					return
				}
				listener(message)
			})
		},
		close() {
			platform.close?.()
		}
	}
	// Forward conditionally so `transport.onClose === undefined` stays a reliable
	// signal that the platform cannot report connection loss.
	if (platform.onClose) {
		transport.onClose = (listener) => platform.onClose!(listener)
	}
	return transport
}
