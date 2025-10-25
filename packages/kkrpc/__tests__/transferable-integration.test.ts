import { serializeMessage, deserializeMessage, transfer } from "../src/serialization.ts"
import { WorkerParentIO, WorkerChildIO } from "../src/adapters/worker.ts"
import { IframeParentIO, IframeChildIO } from "../src/adapters/iframe.ts"
import { RPCChannel } from "../src/channel.ts"
import { 
	isTransferable, 
	extractTransferables, 
	analyzeTransferability,
	createTransferableWrapper 
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

// Mock Worker for testing
class MockWorker {
	onmessage: ((event: MessageEvent) => void) | null = null
	terminated = false

	postMessage(data: any, transfers?: any[]) {
		// Simulate async message handling
		setTimeout(() => {
			if (this.onmessage) {
				this.onmessage({ data } as MessageEvent)
			}
		}, 0)
	}

	terminate() {
		this.terminated = true
	}
}

// Mock self for worker context
const mockSelf = {
	onmessage: null as ((event: MessageEvent) => void) | null,
	postMessage(data: any, transfers?: any[]) {
		// Simulate async message handling
		setTimeout(() => {
			if (mockSelf.onmessage) {
				mockSelf.onmessage({ data } as MessageEvent)
			}
		}, 0)
	},
	close() {
		// Mock close method
	}
}

describe("Transferable Objects Integration Tests", () => {
	let originalWindow: typeof window
	let originalSelf: typeof self

	beforeEach(() => {
		originalWindow = global.window
		originalSelf = global.self
		// @ts-ignore
		global.window = mockWindow
		// @ts-ignore
		global.self = mockSelf
	})

	afterEach(() => {
		// Restore original environment
		// @ts-ignore
		global.window = originalWindow
		// @ts-ignore
		global.self = originalSelf
	})

	describe("Serialization with Transferables", () => {
		it("should serialize and deserialize messages with transferable objects", async () => {
			const buffer = new ArrayBuffer(8)
			const port = new mockWindow.MessagePort()
			
			const message = {
				id: "test-id",
				method: "testMethod",
				args: [
					{ buffer, regular: "string" },
					port
				],
				type: "request" as const
			}

			const { data: serialized, transfers } = serializeMessage(message)
			
			// Verify that transferables were extracted
			expect(transfers).toContain(buffer)
			expect(transfers).toContain(port)
			expect(transfers).toHaveLength(2)

			// Deserialize and verify
			const deserialized = await deserializeMessage(serialized)
			expect(deserialized.id).toBe(message.id)
			expect(deserialized.method).toBe(message.method)
			expect(deserialized.type).toBe(message.type)
		})

		it("should handle transfer marking with transferables", async () => {
			const buffer = new ArrayBuffer(16)
			const testObj = { data: "test", buffer }
			const markedObj = transfer(testObj, [buffer])

			const message = {
				id: "test-id",
				method: "testMethod",
				args: [markedObj],
				type: "request" as const
			}

			const { data: serialized, transfers } = serializeMessage(message)
			
			// Verify that transferables were included
			expect(transfers).toContain(buffer)
			expect(transfers).toHaveLength(1)

			// Deserialize and verify
			const deserialized = await deserializeMessage(serialized)
			expect(deserialized.args).toHaveLength(1)
		})

		it("should analyze transferability of complex messages", () => {
			const buffer1 = new ArrayBuffer(8)
			const buffer2 = new ArrayBuffer(16)
			const port = new mockWindow.MessagePort()
			
			const complexObj = {
				data: {
					buffers: [buffer1, buffer2],
					port,
					nested: {
						regular: "string",
						buffer: buffer1
					}
				},
				metadata: {
					count: 42,
					name: "test"
				}
			}

			const metrics = analyzeTransferability(complexObj)
			
			expect(metrics.totalObjects).toBeGreaterThan(0)
			expect(metrics.transferableObjects).toBe(3) // 2 buffers + 1 port
			expect(metrics.transferRatio).toBeGreaterThan(0)
			expect(metrics.estimatedMemorySavings).toBe(24) // 8 + 16
		})

		it("should create transferable wrappers", () => {
			const buffer = new ArrayBuffer(8)
			const port = new mockWindow.MessagePort()
			const obj = { data: "test" }
			const transferables = [buffer, port]

			const wrapper = createTransferableWrapper(obj, transferables)
			
			expect(wrapper.data).toBe(obj)
			expect(wrapper.transferables).toEqual(transferables)
			expect(wrapper.transferables).toHaveLength(2)
		})
	})

	describe("Worker Adapter with Transferables", () => {
		it("should handle transferables in WorkerParentIO", async () => {
			const mockWorker = new MockWorker()
			const io = new WorkerParentIO(mockWorker as any)
			
			const buffer = new ArrayBuffer(8)
			const port = new mockWindow.MessagePort()
			const transfers = [buffer, port]

			// Test write with transferables
			await io.write("test message", transfers)
			
			// Verify worker was not terminated
			expect(mockWorker.terminated).toBe(false)
		})

		it("should handle transferables in WorkerChildIO", async () => {
			const io = new WorkerChildIO()
			
			const buffer = new ArrayBuffer(8)
			const port = new mockWindow.MessagePort()
			const transfers = [buffer, port]

			// Test write with transferables
			await io.write("test message", transfers)
		})

		it("should handle invalid transferables gracefully", async () => {
			const mockWorker = new MockWorker()
			const io = new WorkerParentIO(mockWorker as any)
			
			const invalidTransfers = ["not transferable", {}]

			// Should not throw, but should warn and send without transfers
			await expect(io.write("test message", invalidTransfers)).resolves.not.toThrow()
		})
	})

	describe("Iframe Adapter with Transferables", () => {
		it("should handle transferables in IframeParentIO", async () => {
			// Mock target window
			const mockTargetWindow = {
				postMessage: () => {},
				addEventListener: () => {},
				removeEventListener: () => {}
			} as any

			const io = new IframeParentIO(mockTargetWindow)
			
			const buffer = new ArrayBuffer(8)
			const port = new mockWindow.MessagePort()
			const transfers = [buffer, port]

			// Test write with transferables (will queue since port is not initialized)
			await io.write("test message", transfers)
		})

		it("should handle transferables in IframeChildIO", async () => {
			// Mock window.parent
			// @ts-ignore
			global.window = {
				...mockWindow,
				parent: {
					postMessage: () => {},
					addEventListener: () => {},
					removeEventListener: () => {}
				} as any,
				MessageChannel: class MockMessageChannel {
					port1 = new mockWindow.MessagePort()
					port2 = new mockWindow.MessagePort()
				} as any
			}

			const io = new IframeChildIO()
			
			const buffer = new ArrayBuffer(8)
			const port = new mockWindow.MessagePort()
			const transfers = [buffer, port]

			// Test write with transferables
			await io.write("test message", transfers)
		})
	})

	describe("RPCChannel with Transferables", () => {
		it("should handle transferables in method calls", async () => {
			const mockWorker = new MockWorker()
			const io = new WorkerParentIO(mockWorker as any)
			
			const channel = new RPCChannel(io, {
				expose: {
					processData: async (data: any, buffer: ArrayBuffer) => {
						return { processed: true, size: buffer.byteLength }
					}
				}
			})

			const buffer = new ArrayBuffer(32)
			const testApi = channel.getAPI()

			// This would normally call the remote method
			// In this test, we're just verifying the structure
			expect(testApi).toBeDefined()
		})

		it("should handle transferables in property access", async () => {
			const mockWorker = new MockWorker()
			const io = new WorkerParentIO(mockWorker as any)
			
			const channel = new RPCChannel(io, {
				expose: {
					data: {
						buffer: new ArrayBuffer(64),
						value: "test"
					}
				}
			})

			const testApi = channel.getAPI()
			expect(testApi).toBeDefined()
		})
	})

	describe("Performance and Optimization", () => {
		it("should extract transferables efficiently", () => {
			const buffers = Array.from({ length: 100 }, () => new ArrayBuffer(1024))
			const ports = Array.from({ length: 10 }, () => new mockWindow.MessagePort())
			
			const largeObj = {
				buffers,
				ports,
				metadata: {
					count: buffers.length,
					portsCount: ports.length,
					description: "Large object with many transferables"
				}
			}

			const startTime = performance.now()
			const transferables = extractTransferables(largeObj)
			const endTime = performance.now()

			expect(transferables).toHaveLength(110) // 100 buffers + 10 ports
			expect(endTime - startTime).toBeLessThan(100) // Should be fast
		})

		it("should provide accurate transferability metrics", () => {
			const buffer = new ArrayBuffer(1024)
			const port = new mockWindow.MessagePort()
			
			const obj = {
				buffer,
				port,
				regular: "string",
				number: 42,
				nested: {
					buffer: new ArrayBuffer(512),
					data: "nested"
				}
			}

			const metrics = analyzeTransferability(obj)
			
			expect(metrics.transferableObjects).toBe(3) // 2 buffers + 1 port
			expect(metrics.estimatedMemorySavings).toBe(1536) // 1024 + 512
			expect(metrics.transferRatio).toBeGreaterThan(0)
			expect(metrics.transferRatio).toBeLessThan(1)
		})
	})

	describe("Error Handling", () => {
		it("should handle non-transferable objects gracefully", async () => {
			const message = {
				id: "test-id",
				method: "testMethod",
				args: [{ regular: "object" }, 123, "string"],
				type: "request" as const
			}

			const { data: serialized, transfers } = serializeMessage(message)
			
			// Should have no transferables
			expect(transfers).toHaveLength(0)

			// Should still serialize and deserialize correctly
			const deserialized = await deserializeMessage(serialized)
			expect(deserialized.args).toEqual(message.args)
		})

		it("should handle mixed transferable and non-transferable objects", async () => {
			const buffer = new ArrayBuffer(8)
			const message = {
				id: "test-id",
				method: "testMethod",
				args: [buffer, "string", { regular: "object" }],
				type: "request" as const
			}

			const { data: serialized, transfers } = serializeMessage(message)
			
			// Should only extract the buffer
			expect(transfers).toHaveLength(1)
			expect(transfers[0]).toBe(buffer)

			// Should still serialize and deserialize correctly
			const deserialized = await deserializeMessage(serialized)
			expect(deserialized.args).toHaveLength(3)
		})
	})
})