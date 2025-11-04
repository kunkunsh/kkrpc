import { describe, expect, it } from "bun:test"
import {
	processValueForTransfer,
	reconstructValueFromTransfer,
	type TransferSlot
} from "../src/serialization.ts"
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
		const transferredValues: unknown[] = []

		// Process the value recursively
		// This should:
		// 1. Find the marked transferable in the nested structure
		// 2. Extract the buffer into transferables array
		// 3. Replace the value with a placeholder string
		// 4. Create a transfer slot to track the replacement
		const processed = processValueForTransfer(
			value,
			transferables,
			transferSlots,
			transferredValues
		)

		// Verify one transferable was found
		expect(transferables).toHaveLength(1)
		expect(transferables[0]).toBe(buffer)

		// Verify one transfer slot was created
		expect(transferSlots).toHaveLength(1)
		// Ensure transferred values align with slots
		expect(transferredValues).toHaveLength(1)
		expect(transferredValues[0]).toBe(buffer)

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
		const transferredValues: unknown[] = []

		// Process a marked transferable to create placeholder
		// This simulates the sender side processing
		const placeholder = processValueForTransfer(
			transfer(buffer, [buffer]),
			transferables,
			transferSlots,
			transferredValues
		)

		// Verify the buffer was collected for transfer
		expect(transferables[0]).toBe(buffer)

		// Reconstruct the original value from placeholder
		// This simulates the receiver side processing
		// The placeholder string is replaced with the actual transferred value
		const reconstructed = reconstructValueFromTransfer(
			placeholder,
			transferSlots,
			transferredValues
		)

		// Verify we get back the original type
		expect(reconstructed).toBeInstanceOf(ArrayBuffer)
	})

	it("handles multiple transferables in a single transfer() call", () => {
		// This test validates the fix for the bug where multiple transferables
		// in one transfer() call would cause corruption
		const buf1 = new ArrayBuffer(8)
		const buf2 = new ArrayBuffer(16)

		// Create an object with multiple transferables
		const obj = { buf1, buf2 }

		// Mark the object for transfer with BOTH buffers
		// This is the critical test case from the bug report
		const marked = transfer(obj, [buf1, buf2])

		const transferables: Transferable[] = []
		const transferSlots: TransferSlot[] = []
		const transferredValues: unknown[] = []

		// Process the value - this should:
		// 1. Add both buf1 and buf2 to transferables array (for postMessage)
		// 2. Add the original object to transferredValues array (one entry per slot)
		// 3. Create exactly ONE transfer slot
		const placeholder = processValueForTransfer(
			marked,
			transferables,
			transferSlots,
			transferredValues
		)

		// Verify both buffers are in the transferables array
		expect(transferables).toHaveLength(2)
		expect(transferables[0]).toBe(buf1)
		expect(transferables[1]).toBe(buf2)

		// Verify we have exactly ONE slot (not two)
		expect(transferSlots).toHaveLength(1)
		expect(transferSlots[0].type).toBe("raw")

		// Verify we have exactly ONE entry in transferredValues (matching the slot count)
		expect(transferredValues).toHaveLength(1)
		expect(transferredValues[0]).toBe(obj)

		// Reconstruct the value
		const reconstructed = reconstructValueFromTransfer(
			placeholder,
			transferSlots,
			transferredValues
		)

		// Verify we get back the original object with both buffers
		expect(reconstructed).toBe(obj)
		expect(reconstructed.buf1).toBe(buf1)
		expect(reconstructed.buf2).toBe(buf2)
	})

	it("handles multiple separate transfer() calls correctly", () => {
		// This test validates that multiple separate transfer() calls
		// create the correct number of slots and don't interfere with each other
		const buf1 = new ArrayBuffer(8)
		const buf2 = new ArrayBuffer(16)
		const buf3 = new ArrayBuffer(24)

		// Create two separate transfer objects
		const obj1 = transfer({ data: buf1 }, [buf1])
		const obj2 = transfer({ buffers: [buf2, buf3] }, [buf2, buf3])

		// Nest them in a structure
		const value = {
			first: obj1,
			second: obj2
		}

		const transferables: Transferable[] = []
		const transferSlots: TransferSlot[] = []
		const transferredValues: unknown[] = []

		const processed = processValueForTransfer(
			value,
			transferables,
			transferSlots,
			transferredValues
		)

		// Verify all three buffers are in the transferables array
		expect(transferables).toHaveLength(3)
		expect(transferables).toContain(buf1)
		expect(transferables).toContain(buf2)
		expect(transferables).toContain(buf3)

		// Verify we have exactly TWO slots (one per transfer() call)
		expect(transferSlots).toHaveLength(2)

		// Verify transferredValues matches slot count (not transferables count)
		expect(transferredValues).toHaveLength(2)

		// Reconstruct and verify structure is preserved
		const reconstructed = reconstructValueFromTransfer(processed, transferSlots, transferredValues)

		expect(reconstructed.first.data).toBe(buf1)
		expect(reconstructed.second.buffers).toHaveLength(2)
		expect(reconstructed.second.buffers[0]).toBe(buf2)
		expect(reconstructed.second.buffers[1]).toBe(buf3)
	})
})
