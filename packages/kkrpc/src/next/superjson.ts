/**
 * Optional SuperJSON codecs for kkrpc/next.
 *
 * SuperJSON preserves richer JavaScript values such as `Date`, `Map`, `Set`,
 * `BigInt`, and typed arrays when a transport uses string wire values. It is not
 * part of the core `kkrpc/next` entry because importing it adds the `superjson`
 * dependency to browser bundles.
 *
 * These codecs do not support zero-copy transfer because values are serialized
 * into strings. Use object-mode transports and `objectCodec()` when transfer is
 * required.
 *
 * @example
 * ```ts
 * import { createTransport } from "kkrpc/next/transport"
 * import { superJsonCodec } from "kkrpc/next/superjson"
 * import type { RPCMessage } from "kkrpc/next"
 *
 * const transport = createTransport<RPCMessage, string>({
 * 	platform: stringPlatform,
 * 	codec: superJsonCodec<RPCMessage>()
 * })
 * ```
 */

import superjson from "superjson"

import type { Codec } from "./transport.ts"

/** Create a SuperJSON string codec. */
export function superJsonCodec<TMessage>(): Codec<TMessage, string> {
	return {
		capabilities: { transfer: false },
		encode: (message) => superjson.stringify(message),
		decode: (wire) => superjson.parse<TMessage>(wire)
	}
}

/** Create a newline-framed SuperJSON codec for stream transports. */
export function superJsonLineCodec<TMessage>(): Codec<TMessage, string> {
	const codec = superJsonCodec<TMessage>()
	return {
		capabilities: { transfer: false },
		encode: (message) => `${codec.encode(message)}\n`,
		decode: (wire) => codec.decode(wire.trimEnd())
	}
}
