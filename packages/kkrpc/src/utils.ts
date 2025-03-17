/**
 * Generate a random UUID
 * @returns A random UUID
 */
export function generateUUID(): string {
	return new Array(4)
		.fill(0)
		.map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16))
		.join("-")
}
