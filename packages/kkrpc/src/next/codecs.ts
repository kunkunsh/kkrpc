/**
 * Built-in lightweight codecs for kkrpc/next transports.
 *
 * Codecs are deliberately separate from `RPCChannel`: the channel always works
 * with structured `RPCMessage` objects, while codecs decide how those messages
 * become platform wire values. Keeping JSON/object codecs in this separate file
 * lets users import `kkrpc/next` without paying for any serialization helpers.
 */

import type { Codec } from "./transport.ts"

/**
 * Identity codec for platforms that already support object messages.
 *
 * Use this with `postMessage`, in-memory tests, or any platform whose wire value
 * can be the same object that `RPCChannel` emits. Because the message object is
 * preserved, this codec can participate in zero-copy transfer when the platform
 * also supports it.
 *
 * @example
 * ```ts
 * import { objectCodec } from "kkrpc/next/codecs"
 * import { createTransport } from "kkrpc/next/transport"
 *
 * const transport = createTransport({ platform: workerLikePlatform, codec: objectCodec() })
 * ```
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

/**
 * Plain JSON codec for string-based platforms.
 *
 * This codec is intentionally dependency-free and does not preserve values that
 * JSON cannot represent, such as `Date`, `Map`, `Set`, `BigInt`, or transferable
 * identity. Use `kkrpc/next/superjson` when those types are required.
 *
 * @example
 * ```ts
 * import { jsonCodec } from "kkrpc/next/codecs"
 *
 * const wire = jsonCodec<{ ok: boolean }>().encode({ ok: true })
 * ```
 */
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

/**
 * JSON codec with newline framing for stream transports.
 *
 * Stdio and other byte streams need a message boundary. This codec appends a
 * newline on encode and trims the trailing newline on decode, matching the
 * `stdioPlatform()` line splitter.
 *
 * @example
 * ```ts
 * import { jsonLineCodec } from "kkrpc/next/codecs"
 *
 * const codec = jsonLineCodec<{ t: "ping" }>()
 * codec.encode({ t: "ping" }) // '{"t":"ping"}\n'
 * ```
 */
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
