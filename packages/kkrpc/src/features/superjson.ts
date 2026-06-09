/**
 * Optional SuperJSON codecs for stable kkrpc.
 *
 * SuperJSON preserves richer JavaScript values such as `Date`, `Map`, `Set`,
 * `BigInt`, and typed arrays when a transport uses string wire values. It is not
 * part of the core `kkrpc` entry because importing it adds the `superjson`
 * dependency to browser bundles.
 *
 * These codecs do not support zero-copy transfer because values are serialized
 * into strings. Use object-mode transports and `objectCodec()` when transfer is
 * required.
 *
 * @example
 * ```ts
 * import { createTransport } from "kkrpc/transport"
 * import { superjsonCodec } from "kkrpc/superjson"
 * import type { RPCMessage } from "kkrpc"
 *
 * const transport = createTransport<RPCMessage, string>({
 * 	platform: stringPlatform,
 * 	codec: superjsonCodec<RPCMessage>()
 * })
 * ```
 */

import superjson from "superjson"

import type { Codec } from "../core/transport.ts"

/** Create a SuperJSON string codec. */
export function superjsonCodec<TMessage>(): Codec<TMessage, string> {
	return {
		capabilities: { transfer: false },
		encode: (message) => superjson.stringify(message),
		decode: (wire) => superjson.parse<TMessage>(wire)
	}
}

/** Create a newline-framed SuperJSON codec for stream transports. */
export function superjsonLineCodec<TMessage>(): Codec<TMessage, string> {
	const codec = superjsonCodec<TMessage>()
	return {
		capabilities: { transfer: false },
		encode: (message) => `${codec.encode(message)}\n`,
		decode: (wire) => codec.decode(wire.trimEnd())
	}
}
