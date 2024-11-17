export interface API {
	add(a: number, b: number): Promise<number>
	subtract(a: number, b: number): Promise<number>
	addCallback(a: number, b: number, callback: (result: number) => void): void
	math: {
		grade1: {
			add(a: number, b: number, callback?: (result: number) => void): Promise<number>
		}
		grade2: {
			multiply(a: number, b: number, callback?: (result: number) => void): Promise<number>
		}
	}
}

// Define your API methods
export const apiMethods: API = {
	add: async (a: number, b: number) => a + b,
	subtract: async (a: number, b: number) => a - b,
	addCallback: async (a: number, b: number, callback?: (result: number) => void) => {
		callback?.(a + b)
	},
	math: {
		grade1: {
			add: async (a: number, b: number, callback?: (result: number) => void) => {
				callback?.(a + b)
				return a + b
			}
		},
		grade2: {
			multiply: async (a: number, b: number, callback?: (result: number) => void) => {
				callback?.(a * b)
				return a * b
			}
		}
	}
}
