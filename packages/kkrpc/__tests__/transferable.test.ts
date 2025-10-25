import {
	isTransferable,
	isArrayBuffer,
	isMessagePort,
	isImageBitmap,
	isOffscreenCanvas,
	isReadableStream,
	isWritableStream,
	isTransformStream,
	extractTransferables,
	validateTransferables,
	isTransferableSupported,
	filterTransferables,
	createTransferableWrapper,
	analyzeTransferability,
	type TransferMetrics
} from "../src/transferable.ts"
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

// Mock browser environment for testing
const mockWindow = {
	postMessage: () => {},
	ArrayBuffer: global.ArrayBuffer,
	MessagePort: class MockMessagePort {},
	ImageBitmap: class MockImageBitmap {},
	OffscreenCanvas: class MockOffscreenCanvas {},
	ReadableStream: class MockReadableStream {},
	WritableStream: class MockWritableStream {},
	TransformStream: class MockTransformStream {},
	AudioData: class MockAudioData {},
	VideoFrame: class MockVideoFrame {},
	MediaSourceHandle: class MockMediaSourceHandle {},
	FileSystemWritableFileStream: class MockFileSystemWritableFileStream {},
	GPUBuffer: class MockGPUBuffer {},
	GPUTexture: class MockGPUTexture {},
	CanvasGradient: class MockCanvasGradient {},
	CanvasPattern: class MockCanvasPattern {},
	ImageData: class MockImageData {}
}

describe("Transferable Objects Utilities", () => {
	let originalWindow: typeof window

	beforeEach(() => {
		originalWindow = global.window
		// Mock browser environment
		// @ts-ignore
		global.window = mockWindow
	})

	afterEach(() => {
		// Restore original environment
		// @ts-ignore
		global.window = originalWindow
	})

	describe("isTransferable", () => {
		it("should return true for ArrayBuffer", () => {
			const buffer = new ArrayBuffer(8)
			expect(isTransferable(buffer)).toBe(true)
		})

		it("should return true for MessagePort", () => {
			const port = new mockWindow.MessagePort()
			expect(isTransferable(port)).toBe(true)
		})

		it("should return true for ImageBitmap", () => {
			const bitmap = new mockWindow.ImageBitmap()
			expect(isTransferable(bitmap)).toBe(true)
		})

		it("should return true for OffscreenCanvas", () => {
			const canvas = new mockWindow.OffscreenCanvas()
			expect(isTransferable(canvas)).toBe(true)
		})

		it("should return true for ReadableStream", () => {
			const stream = new mockWindow.ReadableStream()
			expect(isTransferable(stream)).toBe(true)
		})

		it("should return true for WritableStream", () => {
			const stream = new mockWindow.WritableStream()
			expect(isTransferable(stream)).toBe(true)
		})

		it("should return true for TransformStream", () => {
			const stream = new mockWindow.TransformStream()
			expect(isTransferable(stream)).toBe(true)
		})

		it("should return false for regular objects", () => {
			expect(isTransferable({})).toBe(false)
			expect(isTransferable([])).toBe(false)
			expect(isTransferable("string")).toBe(false)
			expect(isTransferable(123)).toBe(false)
			expect(isTransferable(null)).toBe(false)
			expect(isTransferable(undefined)).toBe(false)
		})
	})

	describe("Type guards", () => {
		it("should correctly identify ArrayBuffer", () => {
			const buffer = new ArrayBuffer(8)
			expect(isArrayBuffer(buffer)).toBe(true)
			expect(isArrayBuffer({})).toBe(false)
		})

		it("should correctly identify MessagePort", () => {
			const port = new mockWindow.MessagePort()
			expect(isMessagePort(port)).toBe(true)
			expect(isMessagePort({})).toBe(false)
		})

		it("should correctly identify ImageBitmap", () => {
			const bitmap = new mockWindow.ImageBitmap()
			expect(isImageBitmap(bitmap)).toBe(true)
			expect(isImageBitmap({})).toBe(false)
		})

		it("should correctly identify OffscreenCanvas", () => {
			const canvas = new mockWindow.OffscreenCanvas()
			expect(isOffscreenCanvas(canvas)).toBe(true)
			expect(isOffscreenCanvas({})).toBe(false)
		})

		it("should correctly identify ReadableStream", () => {
			const stream = new mockWindow.ReadableStream()
			expect(isReadableStream(stream)).toBe(true)
			expect(isReadableStream({})).toBe(false)
		})

		it("should correctly identify WritableStream", () => {
			const stream = new mockWindow.WritableStream()
			expect(isWritableStream(stream)).toBe(true)
			expect(isWritableStream({})).toBe(false)
		})

		it("should correctly identify TransformStream", () => {
			const stream = new mockWindow.TransformStream()
			expect(isTransformStream(stream)).toBe(true)
			expect(isTransformStream({})).toBe(false)
		})
	})

	describe("extractTransferables", () => {
		it("should extract transferables from simple objects", () => {
			const buffer = new ArrayBuffer(8)
			const port = new mockWindow.MessagePort()
			const obj = {
				buffer,
				port,
				regular: "string",
				number: 42
			}

			const transferables = extractTransferables(obj)
			expect(transferables).toHaveLength(2)
			expect(transferables).toContain(buffer)
			expect(transferables).toContain(port)
		})

		it("should extract transferables from arrays", () => {
			const buffer1 = new ArrayBuffer(8)
			const buffer2 = new ArrayBuffer(16)
			const arr = [buffer1, "string", buffer2, 123]

			const transferables = extractTransferables(arr)
			expect(transferables).toHaveLength(2)
			expect(transferables).toContain(buffer1)
			expect(transferables).toContain(buffer2)
		})

		it("should handle nested objects", () => {
			const buffer = new ArrayBuffer(8)
			const obj = {
				nested: {
					buffer,
					deep: {
						port: new mockWindow.MessagePort()
					}
				},
				regular: "string"
			}

			const transferables = extractTransferables(obj)
			expect(transferables).toHaveLength(2)
		})

		it("should handle circular references", () => {
			const buffer = new ArrayBuffer(8)
			const obj: any = { buffer }
			obj.self = obj

			const transferables = extractTransferables(obj)
			expect(transferables).toHaveLength(1)
			expect(transferables[0]).toBe(buffer)
		})

		it("should return empty array for non-transferable values", () => {
			const transferables = extractTransferables({ regular: "object", number: 42 })
			expect(transferables).toHaveLength(0)
		})
	})

	describe("validateTransferables", () => {
		it("should validate all transferables", () => {
			const buffer = new ArrayBuffer(8)
			const port = new mockWindow.MessagePort()
			const transferables = [buffer, port]

			expect(() => validateTransferables(transferables)).not.toThrow()
			expect(validateTransferables(transferables)).toBe(true)
		})

		it("should throw for non-transferable objects", () => {
			const transferables = [new ArrayBuffer(8), "not transferable", {}]

			expect(() => validateTransferables(transferables)).toThrow(
				"Object at index 1 is not transferable"
			)
		})

		it("should handle empty arrays", () => {
			expect(() => validateTransferables([])).not.toThrow()
			expect(validateTransferables([])).toBe(true)
		})
	})

	describe("isTransferableSupported", () => {
		it("should return true in browser environment", () => {
			expect(isTransferableSupported()).toBe(true)
		})

		it("should return false in non-browser environment", () => {
			// @ts-ignore
			delete global.window
			expect(isTransferableSupported()).toBe(false)
		})
	})

	describe("filterTransferables", () => {
		it("should filter only transferable objects", () => {
			const buffer = new ArrayBuffer(8)
			const port = new mockWindow.MessagePort()
			const items = [buffer, "string", port, 123, {}]

			const transferables = filterTransferables(items)
			expect(transferables).toHaveLength(2)
			expect(transferables).toContain(buffer)
			expect(transferables).toContain(port)
		})

		it("should return empty array for no transferables", () => {
			const items = ["string", 123, {}]
			const transferables = filterTransferables(items)
			expect(transferables).toHaveLength(0)
		})
	})

	describe("createTransferableWrapper", () => {
		it("should create a wrapper with transferables", () => {
			const buffer = new ArrayBuffer(8)
			const port = new mockWindow.MessagePort()
			const obj = { data: "test" }
			const transferables = [buffer, port]

			const wrapper = createTransferableWrapper(obj, transferables)

			expect(wrapper.data).toBe(obj)
			expect(wrapper.transferables).toEqual(transferables)
			expect(wrapper.transferables).not.toBe(transferables) // Should be a copy
		})
	})

	describe("analyzeTransferability", () => {
		it("should analyze transferability of simple objects", () => {
			const buffer = new ArrayBuffer(8)
			const obj = {
				buffer,
				regular: "string",
				number: 42
			}

			const metrics = analyzeTransferability(obj)

			expect(metrics.totalObjects).toBeGreaterThan(0)
			expect(metrics.transferableObjects).toBe(1)
			expect(metrics.transferRatio).toBeGreaterThan(0)
			expect(metrics.estimatedMemorySavings).toBe(8)
		})

		it("should analyze transferability of arrays", () => {
			const buffer1 = new ArrayBuffer(8)
			const buffer2 = new ArrayBuffer(16)
			const arr = [buffer1, "string", buffer2, 123]

			const metrics = analyzeTransferability(arr)

			expect(metrics.totalObjects).toBeGreaterThan(0)
			expect(metrics.transferableObjects).toBe(2)
			expect(metrics.transferRatio).toBeGreaterThan(0)
			expect(metrics.estimatedMemorySavings).toBe(24) // 8 + 16
		})

		it("should handle objects with no transferables", () => {
			const obj = { regular: "string", number: 42 }

			const metrics = analyzeTransferability(obj)

			expect(metrics.totalObjects).toBeGreaterThan(0)
			expect(metrics.transferableObjects).toBe(0)
			expect(metrics.transferRatio).toBe(0)
			expect(metrics.estimatedMemorySavings).toBe(0)
		})

		it("should handle empty objects", () => {
			const metrics = analyzeTransferability({})

			expect(metrics.totalObjects).toBe(1) // The empty object itself
			expect(metrics.transferableObjects).toBe(0)
			expect(metrics.transferRatio).toBe(0)
			expect(metrics.estimatedMemorySavings).toBe(0)
		})
	})

	describe("Edge cases", () => {
		it("should handle null and undefined values", () => {
			expect(isTransferable(null)).toBe(false)
			expect(isTransferable(undefined)).toBe(false)
			expect(extractTransferables(null)).toEqual([])
			expect(extractTransferables(undefined)).toEqual([])
		})

		it("should handle primitive values", () => {
			expect(isTransferable("string")).toBe(false)
			expect(isTransferable(123)).toBe(false)
			expect(isTransferable(true)).toBe(false)
			expect(isTransferable(Symbol())).toBe(false)
		})

		it("should handle functions", () => {
			expect(isTransferable(() => {})).toBe(false)
			expect(extractTransferables(() => {})).toEqual([])
		})

		it("should handle complex nested structures", () => {
			const buffer = new ArrayBuffer(8)
			const complex = {
				arr: [
					{ nested: { buffer } },
					"string",
					[buffer, "nested array"]
				],
				obj: {
					port: new mockWindow.MessagePort(),
					deep: {
						very: {
							deep: {
								buffer: new ArrayBuffer(16)
							}
						}
					}
				}
			}

			const transferables = extractTransferables(complex)
			expect(transferables).toHaveLength(3) // 3 ArrayBuffers
		})
	})
})