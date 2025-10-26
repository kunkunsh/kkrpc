import { describe, expect, it } from "bun:test"
import { processValueForTransfer, reconstructValueFromTransfer, type TransferSlot } from "../src/serialization.ts"
import { registerTransferHandler, transferHandlers } from "../src/transfer-handlers.ts"
import { hasTransferDescriptor, takeTransferDescriptor, transfer } from "../src/transfer.ts"

describe("transfer API", () => {
	it("marks objects for transfer", () => {
		// Create a test buffer and wrap it in an object
		const buffer = new ArrayBuffer(16)
		const value = { buf: buffer }

		// Mark the object for transfer - this stores transfer metadata in a WeakMap
		// The WeakMap ensures the transfer descriptor is automatically garbage collected
		// when the object is no longer referenced, preventing memory leaks
		transfer(value, [buffer])
		
		// Verify the transfer descriptor is cached
		expect(hasTransferDescriptor(value)).toBe(true)

		// Retrieve and remove the transfer descriptor
		// This simulates what happens during message serialization
		const descriptor = takeTransferDescriptor(value)
		expect(descriptor?.transfers).toEqual([buffer])
		
		// Verify the descriptor is removed after taking it
		// This ensures each transfer operation is one-time use
		expect(hasTransferDescriptor(value)).toBe(false)
	})

	it("throws when called with a primitive", () => {
		// Transfer only works with objects that can contain transferable resources
		// Primitives (numbers, strings, etc.) cannot be transferred and must be copied
		// This test validates the API enforces this constraint
		expect(() => transfer(42 as any, [])).toThrow()
	})
})

describe("transfer handlers", () => {
	it("serializes and deserializes via custom handler", () => {
		// Define a custom class that contains transferable resources
		// This represents a real-world use case where you have complex objects
		// with internal transferable buffers that need special handling
		class VideoFrame {
			constructor(
				public buffer: ArrayBuffer,
				public metadata: { width: number; height: number }
			) {}
		}

		// Register a custom transfer handler for VideoFrame
		// Custom handlers are needed for non-native transferable types
		// Native types (ArrayBuffer, MessagePort, etc.) are handled automatically
		registerTransferHandler("videoFrame", {
			// Type guard to identify VideoFrame instances
			canHandle: (value): value is VideoFrame => value instanceof VideoFrame,
			// Serialize returns [serializedData, transferablesArray]
			// The buffer is extracted for transfer, metadata is serialized normally
			serialize: (frame) => [
				{ buffer: frame.buffer, metadata: frame.metadata },
				[frame.buffer] // Transfer the actual ArrayBuffer
			],
			// Reconstruct VideoFrame from serialized data
			deserialize: (data) => new VideoFrame(data.buffer, data.metadata)
		})

		// Verify handler was registered correctly
		const handler = transferHandlers.get("videoFrame")
		expect(handler).toBeDefined()
		
		// Clean up to avoid test interference
		transferHandlers.delete("videoFrame")
	})
})

describe("processValueForTransfer", () => {
	it("collects transferables from nested structures", () => {
		// Create a buffer to transfer
		const buffer = new ArrayBuffer(8)
		
		// Create a nested object structure with a marked transferable
		// This tests the recursive processing capability
		const value = {
			payload: {
				inner: transfer(buffer, [buffer])
			}
		}

		// Arrays to collect transferables and slot information
		const transferables: Transferable[] = []
		const transferSlots: TransferSlot[] = []

		// Process the value recursively
		// This should:
		// 1. Find the marked transferable in the nested structure
		// 2. Extract the buffer into transferables array
		// 3. Replace the value with a placeholder string
		// 4. Create a transfer slot to track the replacement
		const processed = processValueForTransfer(value, transferables, transferSlots)
		
		// Verify one transferable was found
		expect(transferables).toHaveLength(1)
		expect(transferables[0]).toBe(buffer)
		
		// Verify one transfer slot was created
		expect(transferSlots).toHaveLength(1)
		
		// Verify the original value was replaced with a placeholder string
		// The placeholder follows the format "__kkrpc_transfer_0"
		expect(typeof processed.payload.inner).toBe("string")
	})

	it("reconstructs transferred values", () => {
		// Create a buffer for testing
		const buffer = new ArrayBuffer(4)
		
		// Arrays to hold transfer information
		const transferables: Transferable[] = []
		const transferSlots: TransferSlot[] = []

		// Process a marked transferable to create placeholder
		// This simulates the sender side processing
		const placeholder = processValueForTransfer(transfer(buffer, [buffer]), transferables, transferSlots)
		
		// Verify the buffer was collected for transfer
		expect(transferables[0]).toBe(buffer)
		
		// Reconstruct the original value from placeholder
		// This simulates the receiver side processing
		// The placeholder string is replaced with the actual transferred value
		const reconstructed = reconstructValueFromTransfer(placeholder, transferSlots, transferables)
		
		// Verify we get back the original type
		expect(reconstructed).toBeInstanceOf(ArrayBuffer)
	})
})
