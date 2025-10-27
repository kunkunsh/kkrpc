import { transfer } from "../../src/transfer.ts"

export interface API {
	echo(message: string): Promise<string>
	add(a: number, b: number): Promise<number>
	subtract(a: number, b: number): Promise<number>
	addCallback(a: number, b: number, callback: (result: number) => void): void
	processBuffer(buffer: ArrayBuffer): Promise<number>
	processMultiTransfer(obj: { buf1: ArrayBuffer; buf2: ArrayBuffer; c: number }): Promise<{ b1: number; b2: number; c: number }>
	createBuffer(size: number): Promise<ArrayBuffer>
	math: {
		grade1: {
			add(a: number, b: number, callback?: (result: number) => void): Promise<number>
		}
		grade2: {
			multiply(a: number, b: number, callback?: (result: number) => void): Promise<number>
		}
		grade3: {
			divide(a: number, b: number, callback?: (result: number) => void): Promise<number>
		}
	}
	// New features for testing
	counter: number
	nested: {
		value: string
		deepObj: {
			prop: boolean
		}
	}
	TestClass: new (name: string) => { name: string; greet(): string }
	throwSimpleError(): never
	throwCustomError(): never
	throwErrorWithCause(): never
	throwErrorWithProperties(): never
}

class CustomError extends Error {
	constructor(message: string, public code: number) {
		super(message)
		this.name = 'CustomError'
	}
}

// Define your API methods
export const apiMethods: API = {
	echo: async (message: string) => {
		console.log(message)
		return message
	},
	add: async (a: number, b: number) => a + b,
	subtract: async (a: number, b: number) => a - b,
	addCallback: async (a: number, b: number, callback?: (result: number) => void) => {
		callback?.(a + b)
	},
	processBuffer: async (buffer: ArrayBuffer) => buffer.byteLength,
	processMultiTransfer: async (obj: { buf1: ArrayBuffer; buf2: ArrayBuffer; c: number }) => {
		if (!(obj.buf1 instanceof ArrayBuffer)) {
			throw new Error(`obj.buf1 is not an ArrayBuffer, but ${obj.buf1?.constructor.name}`)
		}
		if (!(obj.buf2 instanceof ArrayBuffer)) {
			throw new Error(`obj.buf2 is not an ArrayBuffer, but ${obj.buf2?.constructor.name}`)
		}
		return {
			b1: obj.buf1.byteLength,
			b2: obj.buf2.byteLength,
			c: obj.c
		}
	},
	createBuffer: async (size: number) => {
		const buffer = new ArrayBuffer(size)
		return transfer(buffer, [buffer])
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
		},
		grade3: {
			divide: async (a: number, b: number, callback?: (result: number) => void) => {
				callback?.(a / b)
				return a / b
			}
		}
	},
	// New property access features
	counter: 42,
	nested: {
		value: "hello world",
		deepObj: {
			prop: true
		}
	},
	// Constructor for testing
	TestClass: class TestClass {
		constructor(public name: string) {}
		greet() {
			return `Hello, ${this.name}!`
		}
	},
	// Error testing methods
	throwSimpleError() {
		throw new Error("This is a simple error")
	},
	throwCustomError() {
		throw new CustomError("This is a custom error", 404)
	},
	throwErrorWithCause() {
		const cause = new Error("Root cause")
		throw new Error("This error has a cause", { cause })
	},
	throwErrorWithProperties() {
		const error = new Error("This error has custom properties")
		;(error as any).timestamp = new Date().toISOString()
		;(error as any).userId = "user123"
		;(error as any).requestId = "req-456"
		throw error
	}
}
