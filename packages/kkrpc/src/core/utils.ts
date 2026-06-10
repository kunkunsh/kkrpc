/**
 * Small utility helpers used by stable core modules.
 *
 * This file currently exposes a UUID-like identifier helper for runtime paths
 * that do not require cryptographic UUID semantics.
 */

/** Generate a random UUID-like id string. */
export function generateUUID(): string {
	return new Array(4)
		.fill(0)
		.map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16))
		.join("-")
}
