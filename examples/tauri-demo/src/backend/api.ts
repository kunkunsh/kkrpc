function fibonacci(n: number): Promise<number> {
	if (n <= 0) return Promise.resolve(0)
	if (n === 1) return Promise.resolve(1)
	return Promise.all([fibonacci(n - 1), fibonacci(n - 2)]).then(([a, b]) => a + b)
}

export const apiMethods = {
	test: () => {
		return Promise.resolve("Hello from Node.js")
	},
	add: (a: number, b: number) => {
		return Promise.resolve(a + b)
	},
	fibonacci: (n: number) => {
		return fibonacci(n)
	}
}
