/** Built-in lightweight codecs for stable kkrpc transports. */

import type { Codec } from "./transport.ts"

/** Identity codec for platforms that already support object messages. */
export function objectCodec<TMessage>(): Codec<TMessage, TMessage> {
	return {
		capabilities: { transfer: true },
		encode(message: TMessage) {
			return message
		},
		decode(wire: TMessage) {
			return wire
		}
	}
}

/** Plain JSON codec for string-based platforms. */
export function jsonCodec<TMessage>(): Codec<TMessage, string> {
	return {
		capabilities: { transfer: false },
		encode(message: TMessage) {
			return JSON.stringify(message)
		},
		decode(wire: string) {
			return JSON.parse(wire) as TMessage
		}
	}
}

/** JSON codec with newline framing for stream transports. */
export function jsonLineCodec<TMessage>(): Codec<TMessage, string> {
	const codec = jsonCodec<TMessage>()
	return {
		capabilities: { transfer: false },
		encode(message: TMessage) {
			return `${codec.encode(message)}\n`
		},
		decode(wire: string) {
			return codec.decode(wire.trimEnd())
		}
	}
}
