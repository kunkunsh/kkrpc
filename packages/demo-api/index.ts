export type API = {
	add: (a: number, b: number, callback?: (sum: number) => void) => Promise<number>
}

export const apiImplementation: API = {
	add: (a, b, callback) => {
		callback?.(a + b)
		return Promise.resolve(a + b)
	}
}

export type APINested = {
	math: {
		grade1: {
			add: (a: number, b: number, callback?: (sum: number) => void) => Promise<number>
		}
		grade2: {
			multiply: (a: number, b: number, callback?: (product: number) => void) => Promise<number>
		}
	}
}

export const apiImplementationNested: APINested = {
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
