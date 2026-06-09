/** Transport composition primitives for stable kkrpc RPC channels. */

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
