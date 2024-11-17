export type API = {
	add: (a: number, b: number, callback?: (sum: number) => void) => Promise<number>
}

export const apiImplementation: API = {
	add: async (a, b, callback) => {
		callback?.(a + b)
		return a + b
	}
}

export type API2 = {
	math: {
		grade1: {
			add: (a: number, b: number, callback?: (sum: number) => void) => Promise<number>
		}
		grade2: {
			multiply: (a: number, b: number, callback?: (product: number) => void) => Promise<number>
		}
	}
}

export const apiImplementation2: API2 = {
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
		}
	}
}
