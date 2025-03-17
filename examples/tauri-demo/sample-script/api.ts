/**
 * Naive implementation of fibonacci sequence, simulate heavy computation
 * @param n
 * @returns
 */
export function fibonacci(n: number): Promise<number> {
	console.error("start computing fibonacci", n)
	if (n <= 1) return Promise.resolve(n)
	return Promise.all([fibonacci(n - 1), fibonacci(n - 2)]).then(([a, b]) => a + b)
}

export const apiMethods = {
	fibonacci
}
