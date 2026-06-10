/**
 * Optional SuperJSON codecs for stable kkrpc transports.
 *
 * SuperJSON preserves richer JavaScript values such as `Date`, `Map`, `Set`,
 * `BigInt`, and typed arrays when a transport uses string wire values. Use these
 * codecs with `createTransport()` when the underlying platform reads and writes
 * strings but application data needs SuperJSON metadata.
 *
 * The module exports both `superJson*` names and lowercase `superjson*` aliases
 * for callers that prefer the package spelling. These codecs do not support
 * zero-copy transfer because values are serialized into strings.
 *
 * ```ts
 * import { createTransport } from "kkrpc/transport"
 * import { superJsonCodec } from "kkrpc/superjson"
 *
 * const transport = createTransport({ platform, codec: superJsonCodec() })
 * ```
 */

import superjson from "superjson"
import type { Codec } from "../core/transport.ts"

/**
 * Create a SuperJSON string codec.
 *
 * Use this with platforms that exchange complete string frames. The codec
 * serializes each RPC message with `superjson.stringify()` and parses it with
 * `superjson.parse()`.
 */
export function superJsonCodec<TMessage>(): Codec<TMessage, string> {
	return {
		capabilities: { transfer: false },
		encode: (message) => superjson.stringify(message),
		decode: (wire) => superjson.parse<TMessage>(wire)
	}
}

/**
 * Create a newline-framed SuperJSON codec for stream transports.
 *
 * Encoded messages end with `\n`, and decoded frames are trimmed before being
 * passed to the base SuperJSON codec.
 */
export function superJsonLineCodec<TMessage>(): Codec<TMessage, string> {
	const codec = superJsonCodec<TMessage>()
	return {
		capabilities: { transfer: false },
		encode: (message) => `${codec.encode(message)}\n`,
		decode: (wire) => codec.decode(wire.trimEnd())
	}
}

/** Lowercase alias for {@link superJsonCodec}. */
export const superjsonCodec = superJsonCodec

/** Lowercase alias for {@link superJsonLineCodec}. */
export const superjsonLineCodec = superJsonLineCodec
