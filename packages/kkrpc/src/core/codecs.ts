/**
 * Built-in object, JSON, and JSON-line codecs for stable transports.
 *
 * Use `objectCodec()` for platforms that already carry JavaScript values,
 * `jsonCodec()` for plain string messages, and `jsonLineCodec()` for stream
 * transports that need newline framing.
 */

import type { Codec } from "./transport.ts"

/**
 * Identity codec for platforms that already support object messages.
 *
 * The codec advertises transfer support because it does not serialize or clone
 * message values.
 */
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

/** Plain JSON codec for string-based platforms. Transferables are not preserved. */
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

/** JSON codec with newline framing for stream transports such as stdio. */
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
