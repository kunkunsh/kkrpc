/**
 * Small utility helpers used by stable core modules.
 */

let idCounter = 0

/**
 * Generate a unique id string for RPC requests, callbacks, and streams.
 *
 * Prefers `crypto.randomUUID()`. On runtimes without it, falls back to a value
 * combining the current time, a process-monotonic counter, and randomness. The
 * counter guarantees uniqueness within a single process even if the clock and
 * `Math.random()` collide, so a channel never reuses an id for two live requests.
 */
export function generateId(): string {
	const uuid = globalThis.crypto?.randomUUID?.()
	if (uuid) return uuid
	return `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2)}`
}
