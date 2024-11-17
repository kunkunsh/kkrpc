export type API = {
	echo: (message: string, callback?: (echo: string) => void) => Promise<string>
	add: (a: number, b: number, callback?: (sum: number) => void) => Promise<number>
}

export const apiImplementation: API = {
	echo: (message, callback) => {
		callback?.(message)
		return Promise.resolve(message)
	},
	add: (a, b, callback) => {
		callback?.(a + b)
		return Promise.resolve(a + b)
	}
}

export type APINested = {
	echo: (message: string, callback?: (echo: string) => void) => Promise<string>
	math: {
		grade1: {
			add: (a: number, b: number, callback?: (sum: number) => void) => Promise<number>
		}
		grade2: {
			multiply: (a: number, b: number, callback?: (product: number) => void) => Promise<number>
		}
		grade3: {
			divide(a: number, b: number, callback?: (result: number) => void): Promise<number>
		}
	}
}

export const apiImplementationNested: APINested = {
	echo: (message, callback) => {
		callback?.(message)
		return Promise.resolve(message)
	},
	math: {
		grade1: {
			add: (a, b, callback) => {
				callback?.(a + b)
				return Promise.resolve(a + b)
			}
		},
		grade2: {
			multiply: (a, b, callback) => {
				callback?.(a * b)
				return Promise.resolve(a * b)
			}
		},
		grade3: {
			divide: (a, b, callback) => {
				callback?.(a / b)
				if (b === 0) {
					throw new Error("Division by zero")
				}
				return Promise.resolve(a / b)
			}
		}
	}
}
