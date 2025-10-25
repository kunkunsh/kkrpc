# Transferable Objects Implementation Plan for kkrpc (FINAL)

## Executive Summary

This document presents the **final, unified implementation plan** for adding transferable object support to kkrpc. It combines the best architectural decisions from multiple design proposals to create a pragmatic, production-ready solution.

**Key Principles:**

- ✅ **Zero-copy transfers** for postMessage-based transports (Workers, iframes)
- ✅ **Backward compatible** - existing code continues to work
- ✅ **Multi-transport support** - graceful fallback for non-transfer transports
- ✅ **Clean architecture** - minimal changes to existing code
- ✅ **Type-safe** - full TypeScript support
- ✅ **Simplified design** - leverages browser's native transferable support

**Timeline:** 6 weeks  
**Risk Level:** Low-Medium (incremental, well-tested approach)  
**Breaking Changes:** None

**Important Note:** This plan follows Comlink's proven design. Transfer handlers are **only for custom types**. Native transferable types (`ArrayBuffer`, `MessagePort`, `ImageBitmap`, `OffscreenCanvas`, `ReadableStream`, `WritableStream`, etc.) are handled automatically by the browser's `postMessage` API and **do not need handlers**. See [MDN: Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) for the full list of 15+ natively supported types.

---

## 1. Feature Comparison: Comlink vs kkrpc

### Current State

| Feature             | kkrpc (Current)                            | Comlink                  | kkrpc (Target)   |
| ------------------- | ------------------------------------------ | ------------------------ | ---------------- |
| **Communication**   | ✅ Bidirectional                           | 🟡 Mostly Unidirectional | ✅ Bidirectional |
| **Transports**      | ✅ Multi (stdio, HTTP, WS, Worker, iframe) | ❌ postMessage only      | ✅ Multi         |
| **Property Access** | ✅ Full (get/set)                          | ❌ Methods only          | ✅ Full          |
| **Serialization**   | 🟡 String-based (superjson)                | ✅ Structured clone      | ✅ Hybrid        |
| **Transferables**   | ❌ Not supported                           | ✅ First-class           | ✅ First-class   |
| **Extensibility**   | ✅ Adapters                                | ✅ Transfer handlers     | ✅ Both          |

### Key Architectural Difference

**Comlink:**

```javascript
// Binary protocol
worker.postMessage(wireValue, transferables)
```

**kkrpc (Current):**

```javascript
// String protocol
worker.postMessage(JSON.stringify(message))
```

**kkrpc (Target):**

```javascript
// Hybrid protocol
if (supportsTransfer && hasTransferables) {
	worker.postMessage({ version: 2, payload: message }, transferables)
} else {
	worker.postMessage(JSON.stringify(message)) // Backward compatible
}
```

---

## 2. Core Architecture

### 2.1 Wire Protocol v2

Introduce a new wire format that wraps the existing Message format:

```typescript
// packages/kkrpc/src/serialization.ts

/**
 * Version 2 wire envelope for transfer-capable transports
 */
export interface WireEnvelope {
	version: 2
	payload: Message<any>
	transferSlots?: number[] // Indices of arguments that are transferred
	encoding: "object" // Distinguishes from string encoding
}

/**
 * Version 1 format (current) - string-serialized message
 * No changes to existing format
 */
export type WireV1 = string

/**
 * Union type for backward compatibility
 */
export type WireFormat = WireV1 | WireEnvelope

/**
 * Encoded message with mode indicator
 */
export type EncodedMessage =
	| { mode: "string"; data: string }
	| { mode: "structured"; data: WireEnvelope }
```

### 2.2 IoInterface Enhancement

Extend the IoInterface to support both string and structured messages:

```typescript
// packages/kkrpc/src/interface.ts

/**
 * Capabilities that an IO adapter can expose
 */
export interface IoCapabilities {
	/** Supports structured clone (postMessage-based transports) */
	structuredClone?: boolean

	/** Supports transferable objects */
	transfer?: boolean

	/** Supported transferable types */
	transferTypes?: Array<
		| "ArrayBuffer"
		| "MessagePort"
		| "ImageBitmap"
		| "OffscreenCanvas"
		| "ReadableStream"
		| "WritableStream"
	>
}

/**
 * Message wrapper for transfer-capable transports
 */
export interface IoMessage {
	data: string | WireEnvelope
	transfers?: Transferable[]
}

/**
 * Enhanced IoInterface - backward compatible
 * Adapters can accept either string or IoMessage
 */
export interface IoInterface {
	name: string

	/**
	 * Read returns either:
	 * - string (v1 protocol)
	 * - IoMessage (v2 protocol)
	 * - null (closed)
	 */
	read(): Promise<string | IoMessage | null>

	/**
	 * Write accepts either:
	 * - string (v1 protocol, backward compatible)
	 * - IoMessage (v2 protocol with optional transfers)
	 */
	write(message: string | IoMessage): Promise<void>

	/**
	 * Optional: Expose adapter capabilities
	 */
	capabilities?: IoCapabilities
}
```

**Key Design Decision:** The `write()` and `read()` methods accept union types (`string | IoMessage`), ensuring **full backward compatibility** with existing adapters while enabling new functionality.

---

## 3. Transfer API

### 3.1 Public API

````typescript
// packages/kkrpc/src/transfer.ts

/**
 * Transfer cache stores transferables associated with values
 * WeakMap ensures automatic garbage collection
 */
const transferCache = new WeakMap<object, TransferDescriptor>()

/**
 * Transfer descriptor with optional handler for custom serialization
 */
export interface TransferDescriptor {
	value: unknown
	transfers: Transferable[]
	handler?: string // Name of custom transfer handler
}

/**
 * Marks a value for zero-copy transfer.
 *
 * @param value - The value to transfer (must be an object)
 * @param transfers - Array of Transferable objects to transfer
 * @returns The same value for chaining
 *
 * @example
 * ```typescript
 * const buffer = new ArrayBuffer(1024)
 * await api.processData(transfer(buffer, [buffer]))
 * console.log(buffer.byteLength) // 0 (transferred/neutered)
 * ```
 */
export function transfer<T>(value: T, transfers: Transferable[]): T {
	if (typeof value !== "object" || value === null) {
		throw new Error("transfer() requires an object as first argument")
	}
	transferCache.set(value, { value, transfers })
	return value
}

/**
 * Internal: Retrieve and remove transfer descriptor
 * @internal
 */
export function takeTransferDescriptor(value: unknown): TransferDescriptor | undefined {
	if (typeof value !== "object" || value === null) return undefined
	const descriptor = transferCache.get(value)
	if (descriptor) {
		transferCache.delete(value)
	}
	return descriptor
}

/**
 * Internal: Check if value has transferables
 * @internal
 */
export function hasTransferDescriptor(value: unknown): boolean {
	return typeof value === "object" && value !== null && transferCache.has(value)
}
````

### 3.2 Transfer Handler System

**Important:** Transfer handlers are for **custom serialization only**, not for native transferable types like `ArrayBuffer`, `MessagePort`, `ImageBitmap`, etc. These native types are handled automatically by the browser's `postMessage` API.

````typescript
// packages/kkrpc/src/transfer-handlers.ts

/**
 * Transfer handler interface for custom serialization
 * 
 * Note: This is for CUSTOM types that need special handling.
 * Native transferable types (ArrayBuffer, MessagePort, ImageBitmap, OffscreenCanvas, 
 * ReadableStream, WritableStream, etc.) are handled automatically by the browser.
 * 
 * See: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
 */
export interface TransferHandler<T = any, S = any> {
	/**
	 * Determines if this handler can process the given value
	 */
	canHandle(value: unknown): value is T

	/**
	 * Serializes the value and extracts transferables
	 * @returns Tuple of [serialized value, transferables array]
	 */
	serialize(value: T): [S, Transferable[]]

	/**
	 * Deserializes the value back to its original form
	 */
	deserialize(value: S): T
}

/**
 * Global transfer handler registry
 * Initially empty - users can register custom handlers
 */
export const transferHandlers = new Map<string, TransferHandler>()

/**
 * Register a custom transfer handler for non-standard types
 *
 * @example
 * ```typescript
 * // Example: Custom class with transferable buffer
 * class VideoFrame {
 *   constructor(public buffer: ArrayBuffer, public metadata: any) {}
 * }
 * 
 * transferHandlers.set('videoFrame', {
 *   canHandle: (v): v is VideoFrame => v instanceof VideoFrame,
 *   serialize: (frame) => [
 *     { buffer: frame.buffer, metadata: frame.metadata },
 *     [frame.buffer]  // Transfer the buffer
 *   ],
 *   deserialize: (data) => new VideoFrame(data.buffer, data.metadata)
 * })
 * ```
 */
export function registerTransferHandler<T, S>(name: string, handler: TransferHandler<T, S>): void {
	transferHandlers.set(name, handler as TransferHandler)
}

// ============================================================================
// Native Transferable Types (Handled by Browser)
// ============================================================================

/**
 * The following types are natively supported by postMessage and DO NOT need handlers:
 * 
 * - ArrayBuffer
 * - MessagePort
 * - ImageBitmap
 * - OffscreenCanvas
 * - ReadableStream
 * - WritableStream
 * - TransformStream
 * - AudioData
 * - VideoFrame
 * - RTCDataChannel
 * - WebTransportReceiveStream
 * - WebTransportSendStream
 * - MediaSourceHandle
 * - MediaStreamTrack
 * - MIDIAccess
 * 
 * These work automatically when passed to postMessage() with the transfer array.
 * See: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
 */
````

---

## 4. Message Processing

### 4.1 Encoding Messages

```typescript
// packages/kkrpc/src/serialization.ts

/**
 * Transfer slot marker prefix
 * Used to create placeholders for transferred values
 */
export const TRANSFER_SLOT_PREFIX = "__kkrpc_transfer_"

/**
 * Transfer slot metadata
 */
export interface TransferSlot {
	type: "raw" | "handler"
	handlerName?: string
	metadata?: any
}

/**
 * Encode a message with optional transferables
 * Returns either string (v1) or structured (v2) format
 */
export function encodeMessage<T>(
	message: Message<T>,
	options: SerializationOptions,
	withTransfers: boolean
): EncodedMessage {
	// Legacy path: no transfers, use string serialization
	if (!withTransfers) {
		return {
			mode: "string",
			data: serializeMessage(message, options)
		}
	}

	// New path: structured format with transfer support
	const envelope: WireEnvelope = {
		version: 2,
		payload: message,
		encoding: "object"
	}

	return {
		mode: "structured",
		data: envelope
	}
}

/**
 * Decode a message from wire format
 */
export function decodeMessage<T>(raw: string | WireEnvelope): Message<T> {
	if (typeof raw === "string") {
		// V1 format: deserialize from string
		return deserializeMessage<T>(raw)
	}

	// V2 format: extract payload
	return raw.payload as Message<T>
}

/**
 * Process a value and extract transferables recursively
 * This is the core transfer processing logic
 * 
 * Note: This simplified approach matches Comlink's design:
 * 1. Check if user explicitly marked value with transfer()
 * 2. Check custom transfer handlers
 * 3. Let browser handle native transferables via structured clone
 */
export function processValueForTransfer(
	value: any,
	transferables: Transferable[] = [],
	transferSlots: TransferSlot[] = [],
	slotMap: Map<any, number> = new Map()
): any {
	// Primitive types: return as-is
	if (value === null || typeof value !== "object") {
		return value
	}

	// Check if already processed (avoid infinite recursion)
	if (slotMap.has(value)) {
		const slotIndex = slotMap.get(value)!
		return `${TRANSFER_SLOT_PREFIX}${slotIndex}`
	}

	// Check transfer cache (user explicitly called transfer())
	const descriptor = takeTransferDescriptor(value)
	if (descriptor) {
		const slotIndex = transferSlots.length
		slotMap.set(value, slotIndex)
		transferables.push(...descriptor.transfers)
		transferSlots.push({
			type: "raw",
			metadata: { original: true }
		})
		return `${TRANSFER_SLOT_PREFIX}${slotIndex}`
	}

	// Check CUSTOM transfer handlers (not for native types)
	// Native types (ArrayBuffer, MessagePort, etc.) are handled by browser
	for (const [name, handler] of transferHandlers) {
		if (handler.canHandle(value)) {
			const [serialized, handlerTransferables] = handler.serialize(value)
			const slotIndex = transferSlots.length
			slotMap.set(value, slotIndex)
			transferables.push(...handlerTransferables)
			transferSlots.push({
				type: "handler",
				handlerName: name,
				metadata: serialized
			})
			return `${TRANSFER_SLOT_PREFIX}${slotIndex}`
		}
	}

	// Arrays: process recursively
	if (Array.isArray(value)) {
		return value.map((item) => processValueForTransfer(item, transferables, transferSlots, slotMap))
	}

	// Objects: process recursively
	const processed: any = {}
	for (const [key, val] of Object.entries(value)) {
		processed[key] = processValueForTransfer(val, transferables, transferSlots, slotMap)
	}
	return processed
}

/**
 * Reconstruct a value from transfer slots
 */
export function reconstructValueFromTransfer(
	value: any,
	transferSlots: TransferSlot[],
	transferredValues: any[]
): any {
	// Check if this is a transfer slot reference
	if (typeof value === "string" && value.startsWith(TRANSFER_SLOT_PREFIX)) {
		const slotIndex = parseInt(value.slice(TRANSFER_SLOT_PREFIX.length), 10)
		const slot = transferSlots[slotIndex]
		const transferredValue = transferredValues[slotIndex]

		if (slot.type === "raw") {
			return transferredValue
		} else if (slot.type === "handler" && slot.handlerName) {
			const handler = transferHandlers.get(slot.handlerName)
			if (!handler) {
				throw new Error(`Unknown transfer handler: ${slot.handlerName}`)
			}
			return handler.deserialize(slot.metadata)
		}

		throw new Error(`Invalid transfer slot: ${slotIndex}`)
	}

	// Arrays: reconstruct recursively
	if (Array.isArray(value)) {
		return value.map((item) => reconstructValueFromTransfer(item, transferSlots, transferredValues))
	}

	// Objects: reconstruct recursively
	if (value && typeof value === "object") {
		const reconstructed: any = {}
		for (const [key, val] of Object.entries(value)) {
			reconstructed[key] = reconstructValueFromTransfer(val, transferSlots, transferredValues)
		}
		return reconstructed
	}

	// Primitive: return as-is
	return value
}
```

---

## 5. Adapter Implementation

### 5.1 Worker Adapter

```typescript
// packages/kkrpc/src/adapters/worker.ts

export class WorkerParentIO implements DestroyableIoInterface {
	name = "worker-parent-io"

	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: true,
		transferTypes: ["ArrayBuffer", "MessagePort", "ImageBitmap", "OffscreenCanvas"]
	}

	constructor(private worker: Worker) {
		// ... existing setup
	}

	write(message: string | IoMessage): Promise<void> {
		// V2 protocol with transfers
		if (typeof message === "object" && message.transfers && message.transfers.length > 0) {
			this.worker.postMessage(message.data, message.transfers)
		}
		// V1 protocol or V2 without transfers
		else if (typeof message === "object") {
			this.worker.postMessage(message.data)
		}
		// Legacy string protocol
		else {
			this.worker.postMessage(message)
		}
		return Promise.resolve()
	}

	read(): Promise<string | IoMessage | null> {
		return new Promise((resolve) => {
			const handler = (event: MessageEvent) => {
				this.worker.removeEventListener("message", handler)

				const data = event.data

				// If data is a WireEnvelope, wrap it in IoMessage
				if (typeof data === "object" && data.version === 2) {
					resolve({
						data: data,
						transfers: [] // Already transferred, empty array
					})
				}
				// Legacy string protocol
				else if (typeof data === "string") {
					resolve(data)
				}
				// Unknown format
				else {
					resolve(null)
				}
			}

			this.worker.addEventListener("message", handler)
		})
	}

	// ... rest of implementation
}
```

### 5.2 Iframe Adapter

```typescript
// packages/kkrpc/src/adapters/iframe.ts

export class IframeParentIO implements DestroyableIoInterface {
	name = "iframe-parent-io"

	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: true,
		transferTypes: ["ArrayBuffer", "MessagePort"]
	}

	constructor(
		private iframe: HTMLIFrameElement,
		private targetOrigin: string = "*"
	) {
		// ... existing setup
	}

	write(message: string | IoMessage): Promise<void> {
		const targetWindow = this.iframe.contentWindow
		if (!targetWindow) {
			return Promise.reject(new Error("Iframe not ready"))
		}

		// V2 protocol with transfers
		if (typeof message === "object" && message.transfers && message.transfers.length > 0) {
			targetWindow.postMessage(message.data, this.targetOrigin, message.transfers)
		}
		// V1 protocol or V2 without transfers
		else if (typeof message === "object") {
			targetWindow.postMessage(message.data, this.targetOrigin)
		}
		// Legacy string protocol
		else {
			targetWindow.postMessage(message, this.targetOrigin)
		}
		return Promise.resolve()
	}

	// ... rest of implementation
}
```

### 5.3 Non-Transfer Adapters (stdio, HTTP, WebSocket)

These adapters continue to work unchanged:

```typescript
// No changes needed
// - packages/kkrpc/src/adapters/node.ts
// - packages/kkrpc/src/adapters/http.ts
// - packages/kkrpc/src/adapters/websocket.ts

// They accept string messages and continue to use string protocol
// Transfer markers are automatically stripped during serialization
```

---

## 6. RPCChannel Integration

### 6.1 Enhanced RPCChannel

```typescript
// packages/kkrpc/src/channel.ts

export class RPCChannel<
	LocalAPI extends Record<string, any>,
	RemoteAPI extends Record<string, any>,
	Io extends IoInterface = IoInterface
> {
	private supportsTransfer: boolean = false

	constructor(
		private io: Io,
		options?: {
			expose?: LocalAPI
			serialization?: SerializationOptions
			enableTransfer?: boolean
		}
	) {
		// Check if IO supports transfer
		if (io.capabilities?.transfer === true) {
			this.supportsTransfer = options?.enableTransfer !== false
		}

		// ... rest of constructor
	}

	/**
	 * Call a remote method with optional transferables
	 */
	public callMethod<T extends keyof RemoteAPI>(method: T, args: any[]): Promise<any> {
		return new Promise((resolve, reject) => {
			const messageId = generateUUID()
			this.pendingRequests[messageId] = { resolve, reject }

			// Process arguments for transfers
			const transferables: Transferable[] = []
			const transferSlots: TransferSlot[] = []
			const processedArgs = args.map((arg) => {
				return processValueForTransfer(arg, transferables, transferSlots)
			})

			const message: Message = {
				id: messageId,
				method: method as string,
				args: processedArgs,
				type: "request"
				// ... other fields
			}

			// Add transfer metadata if present
			if (transferSlots.length > 0) {
				message.transferSlots = transferSlots
			}

			// Encode and send
			const encoded = encodeMessage(
				message,
				this.serializationOptions,
				this.supportsTransfer && transferables.length > 0
			)

			if (encoded.mode === "string") {
				// Legacy path
				this.io.write(encoded.data)
			} else {
				// Transfer path
				this.io.write({
					data: encoded.data,
					transfers: transferables
				})
			}
		})
	}

	/**
	 * Handle incoming request with transferred values
	 */
	private handleRequest(request: Message): void {
		// Reconstruct transferred values
		let args = request.args
		if (request.transferSlots && request.transferSlots.length > 0) {
			// Transferred values are passed through the message event
			const transferredValues = (request as any).__transferredValues || []
			args = args.map((arg: any) =>
				reconstructValueFromTransfer(arg, request.transferSlots!, transferredValues)
			)
		}

		// ... rest of handleRequest with reconstructed args
	}

	// Similar updates for handleGet, handleSet, handleConstruct, sendResponse
}
```

---

## 7. Testing Strategy

### 7.1 Testing Approach

**Testing Order (Easy → Complex):**

1. **Unit Tests** - Core functionality (no workers)
2. **Bun Worker Tests** - Fast, no UI, native transferable support ([Bun.Transferable](https://bun.com/reference/bun/Transferable))
3. **Node.js Worker Tests** - Cross-runtime verification
4. **Browser Worker Tests** - Real browser environment
5. **Browser UI Tests** - Manual + Playwright automation

**Why This Order:**
- ✅ Bun/Node.js workers are faster to test (no browser startup)
- ✅ No UI complexity initially
- ✅ Both support transferables natively
- ✅ Easier debugging without browser DevTools
- ✅ Browser tests validate cross-runtime compatibility

### 7.2 Unit Tests (No Workers)

```typescript
// __tests__/transfer.test.ts

describe("Transfer API", () => {
	describe("transfer()", () => {
		it("should cache transferables", () => {
			const buffer = new ArrayBuffer(8)
			const value = transfer({ data: buffer }, [buffer])
			expect(hasTransferDescriptor(value)).toBe(true)
		})

		it("should throw for non-object values", () => {
			expect(() => transfer(42, [])).toThrow()
		})

		it("should handle multiple transferables", () => {
			const buffer1 = new ArrayBuffer(8)
			const buffer2 = new ArrayBuffer(16)
			const value = transfer({ b1: buffer1, b2: buffer2 }, [buffer1, buffer2])
			const descriptor = takeTransferDescriptor(value)
			expect(descriptor?.transfers).toEqual([buffer1, buffer2])
		})
	})

	describe("TransferHandler", () => {
		it("should support custom handlers", () => {
			class VideoFrame {
				constructor(
					public buffer: ArrayBuffer,
					public metadata: any
				) {}
			}

			registerTransferHandler("videoFrame", {
				canHandle: (v): v is VideoFrame => v instanceof VideoFrame,
				serialize: (frame) => [
					{ buffer: frame.buffer, metadata: frame.metadata },
					[frame.buffer]
				],
				deserialize: (data) => new VideoFrame(data.buffer, data.metadata)
			})

			const frame = new VideoFrame(new ArrayBuffer(8), { width: 640, height: 480 })
			const handler = transferHandlers.get("videoFrame")!
			expect(handler.canHandle(frame)).toBe(true)

			const [serialized, transferables] = handler.serialize(frame)
			expect(transferables).toContain(frame.buffer)
			expect(serialized.metadata.width).toBe(640)
		})

		it("should NOT have built-in handlers for native types", () => {
			// Native types are handled by browser automatically
			expect(transferHandlers.has("arrayBuffer")).toBe(false)
			expect(transferHandlers.has("messagePort")).toBe(false)
			expect(transferHandlers.has("imageBitmap")).toBe(false)
			expect(transferHandlers.has("offscreenCanvas")).toBe(false)
		})
	})

	describe("processValueForTransfer", () => {
		it("should extract transferables from marked values", () => {
			const buffer = new ArrayBuffer(8)
			const value = transfer({ data: buffer }, [buffer])

			const transferables: Transferable[] = []
			const transferSlots: TransferSlot[] = []
			const processed = processValueForTransfer(value, transferables, transferSlots)

			expect(transferables).toContain(buffer)
			expect(transferSlots).toHaveLength(1)
		})

		it("should handle nested objects", () => {
			const buffer1 = new ArrayBuffer(8)
			const buffer2 = new ArrayBuffer(16)
			const value = {
				a: transfer({ buf: buffer1 }, [buffer1]),
				b: transfer({ buf: buffer2 }, [buffer2])
			}

			const transferables: Transferable[] = []
			const transferSlots: TransferSlot[] = []
			processValueForTransfer(value, transferables, transferSlots)

			expect(transferables).toHaveLength(2)
			expect(transferables).toContain(buffer1)
			expect(transferables).toContain(buffer2)
		})
	})
})
```

### 7.3 Bun Worker Tests (Start Here!)

**Why Start with Bun:**
- ⚡ Fast startup and execution
- 🎯 Native transferable support ([Bun.Transferable](https://bun.com/reference/bun/Transferable))
- 🚫 No browser/UI complexity
- ✅ Easy debugging

```typescript
// __tests__/bun-worker-transfer.test.ts

import { Worker } from "bun"
import { describe, it, expect } from "bun:test"

describe("Bun Worker Transfer", () => {
	it("should transfer ArrayBuffer with zero-copy", async () => {
		// Bun supports Worker with transferables
		const worker = new Worker(new URL("./fixtures/bun-worker.ts", import.meta.url))
		const io = new WorkerParentIO(worker)
		const rpc = new RPCChannel(io, { expose: localAPI })
		const api = rpc.getAPI<RemoteAPI>()

		const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer
		const originalByteLength = buffer.byteLength

		const result = await api.processBuffer(transfer(buffer, [buffer]))

		expect(result).toBe(5) // Worker returns buffer length
		expect(buffer.byteLength).toBe(0) // Neutered (transferred)
	})

	it("should handle nested transfers", async () => {
		const worker = new Worker(new URL("./fixtures/bun-worker.ts", import.meta.url))
		const io = new WorkerParentIO(worker)
		const rpc = new RPCChannel(io, { expose: localAPI })
		const api = rpc.getAPI<RemoteAPI>()

		const buffer1 = new ArrayBuffer(8)
		const buffer2 = new ArrayBuffer(16)

		const data = {
			a: { buffer: buffer1 },
			b: { buffer: buffer2 }
		}

		await api.processData(transfer(data, [buffer1, buffer2]))

		expect(buffer1.byteLength).toBe(0)
		expect(buffer2.byteLength).toBe(0)
	})

	it("should handle bidirectional transfers", async () => {
		const worker = new Worker(new URL("./fixtures/bun-worker.ts", import.meta.url))
		const io = new WorkerParentIO(worker)
		const rpc = new RPCChannel(io, { expose: localAPI })
		const api = rpc.getAPI<RemoteAPI>()

		// Client -> Worker
		const buffer1 = new ArrayBuffer(1024)
		await api.sendData(transfer(buffer1, [buffer1]))
		expect(buffer1.byteLength).toBe(0)

		// Worker -> Client
		const buffer2 = await api.getData()
		expect(buffer2).toBeInstanceOf(ArrayBuffer)
		expect(buffer2.byteLength).toBeGreaterThan(0)
	})
})
```

```typescript
// __tests__/fixtures/bun-worker.ts
// Worker implementation for Bun

import { RPCChannel, WorkerChildIO } from "kkrpc"

const localAPI = {
	processBuffer(buffer: ArrayBuffer): number {
		console.log("Worker received buffer:", buffer.byteLength)
		return buffer.byteLength
	},

	processData(data: { a: { buffer: ArrayBuffer }; b: { buffer: ArrayBuffer } }): void {
		console.log("Worker received buffers:", data.a.buffer.byteLength, data.b.buffer.byteLength)
	},

	sendData(buffer: ArrayBuffer): void {
		console.log("Worker received data:", buffer.byteLength)
	},

	getData(): ArrayBuffer {
		const buffer = new ArrayBuffer(2048)
		console.log("Worker sending buffer:", buffer.byteLength)
		return buffer
	}
}

const io = new WorkerChildIO()
const rpc = new RPCChannel(io, { expose: localAPI })
```

### 7.4 Node.js Worker Tests

```typescript
// __tests__/node-worker-transfer.test.ts

import { Worker } from "node:worker_threads"
import { describe, it, expect } from "vitest"

describe("Node.js Worker Transfer", () => {
	it("should transfer ArrayBuffer with zero-copy", async () => {
		// Node.js 12+ supports Worker with transferables
		const worker = new Worker("./fixtures/node-worker.js")
		const io = new WorkerParentIO(worker)
		const rpc = new RPCChannel(io, { expose: localAPI })
		const api = rpc.getAPI<RemoteAPI>()

		const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer
		const originalByteLength = buffer.byteLength

		const result = await api.processBuffer(transfer(buffer, [buffer]))

		expect(result).toBe(5)
		expect(buffer.byteLength).toBe(0) // Neutered
	})

	it("should handle nested transfers", async () => {
		const worker = new Worker("./fixtures/node-worker.js")
		const io = new WorkerParentIO(worker)
		const rpc = new RPCChannel(io, { expose: localAPI })
		const api = rpc.getAPI<RemoteAPI>()

		const buffer1 = new ArrayBuffer(8)
		const buffer2 = new ArrayBuffer(16)

		const data = {
			a: { buffer: buffer1 },
			b: { buffer: buffer2 }
		}

		await api.processData(transfer(data, [buffer1, buffer2]))

		expect(buffer1.byteLength).toBe(0)
		expect(buffer2.byteLength).toBe(0)
	})

	it("should fall back gracefully when transfer not supported", async () => {
		// Use HTTP adapter (no transfer support)
		const io = new HTTPClientIO({ url: "http://localhost:3000" })
		const rpc = new RPCChannel(io, { expose: localAPI })
		const api = rpc.getAPI<RemoteAPI>()

		const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer
		const originalByteLength = buffer.byteLength

		const result = await api.processBuffer(transfer(buffer, [buffer]))

		expect(result).toBe(5)
		// Should NOT be transferred (copied instead)
		expect(buffer.byteLength).toBe(originalByteLength)
	})

		await api.processData(transfer(data, [buffer1, buffer2]))

		expect(buffer1.byteLength).toBe(0)
		expect(buffer2.byteLength).toBe(0)
	})
})
```

### 7.5 Browser Worker Tests (Playwright)

```typescript
// __tests__/browser-worker-transfer.spec.ts

import { test, expect } from "@playwright/test"

test.describe("Browser Worker Transfer", () => {
	test("should transfer ArrayBuffer with zero-copy", async ({ page }) => {
		await page.goto("http://localhost:5173")

		// Execute in browser context
		const result = await page.evaluate(async () => {
			const { RPCChannel, WorkerParentIO, transfer } = window.kkrpc

			const worker = new Worker("/worker.js")
			const io = new WorkerParentIO(worker)
			const rpc = new RPCChannel(io)
			const api = rpc.getAPI()

			const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer
			const originalByteLength = buffer.byteLength

			const result = await api.processBuffer(transfer(buffer, [buffer]))

			return {
				result,
				neutered: buffer.byteLength === 0,
				originalByteLength
			}
		})

		expect(result.result).toBe(5)
		expect(result.neutered).toBe(true)
		expect(result.originalByteLength).toBe(5)
	})

	test("should handle ImageBitmap transfer (browser-only)", async ({ page }) => {
		await page.goto("http://localhost:5173")

		const result = await page.evaluate(async () => {
			const { transfer } = window.kkrpc
			const canvas = document.createElement("canvas")
			canvas.width = 100
			canvas.height = 100

			const bitmap = await createImageBitmap(canvas)
			const originalWidth = bitmap.width

			// Transfer ImageBitmap (browser-only feature)
			const worker = new Worker("/worker.js")
			const io = new WorkerParentIO(worker)
			const rpc = new RPCChannel(io)
			const api = rpc.getAPI()

			await api.processImage(transfer(bitmap, [bitmap]))

			// Check if bitmap was transferred (width becomes 0)
			return {
				originalWidth,
				closed: bitmap.width === 0 // Neutered ImageBitmap
			}
		})

		expect(result.originalWidth).toBe(100)
		expect(result.closed).toBe(true)
	})
})
```

### 7.6 Fallback Tests (Non-Transfer Transports)

```typescript
// __tests__/fallback-transfer.test.ts

describe("Transfer Fallback", () => {
	it("should fall back gracefully when transfer not supported", async () => {
		// Use HTTP adapter (no transfer support)
		const io = new HTTPClientIO({ url: "http://localhost:3000" })
		const rpc = new RPCChannel(io, { expose: localAPI })
		const api = rpc.getAPI<RemoteAPI>()

		const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer
		const originalByteLength = buffer.byteLength

		const result = await api.processBuffer(transfer(buffer, [buffer]))

		expect(result).toBe(5)
		// Should NOT be transferred (copied instead)
		expect(buffer.byteLength).toBe(originalByteLength)
	})

	it("should work with stdio transport", async () => {
		// stdio transport doesn't support transfers
		const result = await api.processBuffer(transfer(buffer, [buffer]))

		expect(result).toBe(5)
		// Buffer remains intact (serialized, not transferred)
		expect(buffer.byteLength).toBe(originalByteLength)
	})
})
```

### 7.3 Performance Tests

```typescript
// __tests__/transfer-performance.test.ts

describe("Transfer Performance", () => {
	it("should be significantly faster than serialization for large buffers", async () => {
		const sizes = [1_000, 10_000, 100_000, 1_000_000, 10_000_000]

		for (const size of sizes) {
			const buffer = new ArrayBuffer(size)

			// Measure transfer time
			const transferStart = performance.now()
			await api.processBuffer(transfer(buffer, [buffer]))
			const transferTime = performance.now() - transferStart

			// Measure copy time (without transfer)
			const copyBuffer = new ArrayBuffer(size)
			const copyStart = performance.now()
			await api.processBuffer(copyBuffer) // No transfer()
			const copyTime = performance.now() - copyStart

			console.log(`Size: ${size}, Transfer: ${transferTime}ms, Copy: ${copyTime}ms`)

			// Transfer should be faster for large buffers
			if (size >= 100_000) {
				expect(transferTime).toBeLessThan(copyTime)
			}
		}
	})

	it("should have minimal overhead for small messages", async () => {
		const message = { value: 42 }

		const iterations = 1000

		const start = performance.now()
		for (let i = 0; i < iterations; i++) {
			await api.process(message)
		}
		const time = performance.now() - start

		const avgTime = time / iterations
		expect(avgTime).toBeLessThan(1) // <1ms average
	})
})
```

---

## 8. Examples & Demo Applications

### 8.1 Example Structure

Create examples in order of complexity:

```
examples/
├── transferable-demo/          # 1. Simple Bun/Node.js example (START HERE)
│   ├── bun-example.ts          # Bun Worker example
│   ├── node-example.ts         # Node.js Worker example
│   ├── worker.ts               # Shared worker code
│   └── README.md
│
├── transferable-browser/       # 2. Browser example (Vite + React/Svelte)
│   ├── src/
│   │   ├── App.tsx             # Main UI
│   │   ├── worker.ts           # Worker code
│   │   └── main.tsx
│   ├── e2e/
│   │   └── transfer.spec.ts    # Playwright tests
│   ├── package.json
│   ├── vite.config.ts
│   └── README.md
│
└── transferable-advanced/      # 3. Advanced features
    ├── custom-handlers/        # Custom transfer handlers
    ├── streaming/              # Stream transfers
    └── performance/            # Performance comparison
```

### 8.2 Example 1: Bun Worker (Simple, No UI)

**Location:** `examples/transferable-demo/`

**Purpose:** Quick validation without browser complexity

```typescript
// examples/transferable-demo/bun-example.ts

import { Worker } from "bun"
import { RPCChannel, WorkerParentIO, transfer } from "kkrpc"

// Create worker
const worker = new Worker(new URL("./worker.ts", import.meta.url))

// Setup RPC
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel(io)
const api = rpc.getAPI<{
	processBuffer(buffer: ArrayBuffer): Promise<number>
	processImage(data: { buffer: ArrayBuffer; width: number; height: number }): Promise<void>
}>()

// Example 1: Simple transfer
console.log("Example 1: Simple ArrayBuffer transfer")
const buffer1 = new ArrayBuffer(1024)
console.log("Before transfer:", buffer1.byteLength) // 1024
const result = await api.processBuffer(transfer(buffer1, [buffer1]))
console.log("Result:", result) // 1024
console.log("After transfer:", buffer1.byteLength) // 0 (neutered!)

// Example 2: Nested transfer
console.log("\nExample 2: Nested transfer")
const imageBuffer = new ArrayBuffer(1920 * 1080 * 4) // RGBA image
const imageData = {
	buffer: imageBuffer,
	width: 1920,
	height: 1080
}
console.log("Before transfer:", imageBuffer.byteLength)
await api.processImage(transfer(imageData, [imageBuffer]))
console.log("After transfer:", imageBuffer.byteLength) // 0 (neutered!)

console.log("\n✅ All examples completed!")
```

```typescript
// examples/transferable-demo/worker.ts

import { RPCChannel, WorkerChildIO } from "kkrpc"

const api = {
	processBuffer(buffer: ArrayBuffer): number {
		console.log("[Worker] Received buffer:", buffer.byteLength)
		// Do some processing...
		return buffer.byteLength
	},

	processImage(data: { buffer: ArrayBuffer; width: number; height: number }): void {
		console.log(
			`[Worker] Received image: ${data.width}x${data.height}, ${data.buffer.byteLength} bytes`
		)
		// Process image...
	}
}

const io = new WorkerChildIO()
const rpc = new RPCChannel(io, { expose: api })
```

**README.md:**
```markdown
# Transferable Demo (Bun)

Quick example showing transferable objects with Bun Workers.

## Run

```bash
bun run bun-example.ts
```

## Expected Output

```
Example 1: Simple ArrayBuffer transfer
Before transfer: 1024
[Worker] Received buffer: 1024
Result: 1024
After transfer: 0

Example 2: Nested transfer
Before transfer: 8294400
[Worker] Received image: 1920x1080, 8294400 bytes
After transfer: 0

✅ All examples completed!
```

## Key Concepts

1. **Zero-copy transfer**: Original buffer is neutered
2. **transfer() function**: Mark objects for transfer
3. **Native types**: ArrayBuffer works automatically
```

### 8.3 Example 2: Browser Example (Vite + Svelte 5)

**Location:** `examples/transferable-browser/`

**Setup:** When ready, run:
```bash
cd examples
npm create vite@latest transferable-browser -- --template svelte-ts
cd transferable-browser
pnpm install
pnpm add kkrpc
pnpm add -D playwright @playwright/test
```

**App Structure:**

```svelte
<!-- examples/transferable-browser/src/App.svelte -->
<script lang="ts">
	import { RPCChannel, WorkerParentIO, transfer } from "kkrpc"
	import { onMount } from "svelte"

	let worker: Worker
	let rpc: RPCChannel<any, any>
	let api: any
	let log = $state<string[]>([])

	onMount(() => {
		worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
		const io = new WorkerParentIO(worker)
		rpc = new RPCChannel(io)
		api = rpc.getAPI()

		addLog("✅ Worker initialized")
	})

	function addLog(message: string) {
		log = [...log, `[${new Date().toLocaleTimeString()}] ${message}`]
	}

	async function testArrayBuffer() {
		addLog("🚀 Testing ArrayBuffer transfer...")
		const buffer = new ArrayBuffer(10 * 1024 * 1024) // 10MB
		addLog(`Created buffer: ${buffer.byteLength} bytes`)

		const start = performance.now()
		const result = await api.processBuffer(transfer(buffer, [buffer]))
		const duration = performance.now() - start

		addLog(`✅ Result: ${result} bytes`)
		addLog(`⚡ Transfer time: ${duration.toFixed(2)}ms`)
		addLog(`🔍 Buffer after transfer: ${buffer.byteLength} bytes (neutered!)`)
	}

	async function testImageBitmap() {
		addLog("🎨 Testing ImageBitmap transfer...")
		const canvas = document.createElement("canvas")
		canvas.width = 1920
		canvas.height = 1080

		const ctx = canvas.getContext("2d")!
		ctx.fillStyle = "red"
		ctx.fillRect(0, 0, canvas.width, canvas.height)

		const bitmap = await createImageBitmap(canvas)
		addLog(`Created ImageBitmap: ${bitmap.width}x${bitmap.height}`)

		const start = performance.now()
		await api.processImage(transfer(bitmap, [bitmap]))
		const duration = performance.now() - start

		addLog(`✅ Image transferred in ${duration.toFixed(2)}ms`)
		addLog(`🔍 Bitmap after transfer: width=${bitmap.width} (neutered!)`)
	}

	async function testPerformance() {
		addLog("⚡ Performance comparison...")

		// Test WITH transfer
		const buffer1 = new ArrayBuffer(100 * 1024 * 1024) // 100MB
		const start1 = performance.now()
		await api.processBuffer(transfer(buffer1, [buffer1]))
		const withTransfer = performance.now() - start1
		addLog(`WITH transfer: ${withTransfer.toFixed(2)}ms`)

		// Test WITHOUT transfer (copy)
		const buffer2 = new ArrayBuffer(100 * 1024 * 1024)
		const start2 = performance.now()
		await api.processBufferCopy(buffer2) // No transfer()
		const withoutTransfer = performance.now() - start2
		addLog(`WITHOUT transfer: ${withoutTransfer.toFixed(2)}ms`)

		const speedup = withoutTransfer / withTransfer
		addLog(`🚀 Speedup: ${speedup.toFixed(1)}x faster!`)
	}
</script>

<div class="app">
	<h1>kkrpc Transferable Objects Demo</h1>

	<div class="buttons">
		<button onclick={testArrayBuffer}>Test ArrayBuffer</button>
		<button onclick={testImageBitmap}>Test ImageBitmap</button>
		<button onclick={testPerformance}>Performance Test</button>
	</div>

	<div class="log">
		<h2>Log</h2>
		<div class="log-content">
			{#each log as entry}
				<div class="log-entry">{entry}</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.app {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem;
	}

	.buttons {
		display: flex;
		gap: 1rem;
		margin: 2rem 0;
	}

	button {
		padding: 0.5rem 1rem;
		font-size: 1rem;
		cursor: pointer;
	}

	.log {
		border: 1px solid #ccc;
		border-radius: 8px;
		padding: 1rem;
	}

	.log-content {
		max-height: 400px;
		overflow-y: auto;
		font-family: monospace;
		font-size: 0.9rem;
	}

	.log-entry {
		padding: 0.25rem 0;
		border-bottom: 1px solid #eee;
	}
</style>
```

```typescript
// examples/transferable-browser/src/worker.ts

import { RPCChannel, WorkerChildIO } from "kkrpc"

const api = {
	processBuffer(buffer: ArrayBuffer): number {
		console.log("[Worker] Processing buffer:", buffer.byteLength)
		// Simulate processing
		const view = new Uint8Array(buffer)
		let sum = 0
		for (let i = 0; i < Math.min(1000, view.length); i++) {
			sum += view[i]
		}
		return buffer.byteLength
	},

	processBufferCopy(buffer: ArrayBuffer): number {
		// Same as processBuffer but without transfer
		console.log("[Worker] Processing buffer (copy):", buffer.byteLength)
		return buffer.byteLength
	},

	processImage(bitmap: ImageBitmap): void {
		console.log(`[Worker] Processing image: ${bitmap.width}x${bitmap.height}`)
		// Process image...
		bitmap.close()
	}
}

const io = new WorkerChildIO()
const rpc = new RPCChannel(io, { expose: api })
```

**Playwright Tests:**

```typescript
// examples/transferable-browser/e2e/transfer.spec.ts

import { test, expect } from "@playwright/test"

test.describe("Transferable Objects Demo", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("http://localhost:5173")
		await page.waitForSelector("h1")
	})

	test("should initialize worker", async ({ page }) => {
		const log = await page.locator(".log-entry").first().textContent()
		expect(log).toContain("✅ Worker initialized")
	})

	test("should transfer ArrayBuffer", async ({ page }) => {
		await page.click("button:has-text('Test ArrayBuffer')")

		// Wait for all log entries
		await page.waitForSelector(".log-entry:has-text('neutered')")

		const logs = await page.locator(".log-entry").allTextContents()
		const neuteredLog = logs.find((log) => log.includes("Buffer after transfer: 0 bytes"))
		expect(neuteredLog).toBeTruthy()
	})

	test("should transfer ImageBitmap", async ({ page }) => {
		await page.click("button:has-text('Test ImageBitmap')")

		await page.waitForSelector(".log-entry:has-text('Bitmap after transfer')")

		const logs = await page.locator(".log-entry").allTextContents()
		const neuteredLog = logs.find((log) => log.includes("width=0"))
		expect(neuteredLog).toBeTruthy()
	})

	test("should show performance improvement", async ({ page }) => {
		await page.click("button:has-text('Performance Test')")

		await page.waitForSelector(".log-entry:has-text('Speedup')")

		const logs = await page.locator(".log-entry").allTextContents()
		const speedupLog = logs.find((log) => log.includes("Speedup:"))
		expect(speedupLog).toBeTruthy()

		// Extract speedup value (e.g., "🚀 Speedup: 45.2x faster!")
		const match = speedupLog?.match(/(\d+\.\d+)x faster/)
		const speedup = match ? parseFloat(match[1]) : 0
		expect(speedup).toBeGreaterThan(10) // Should be at least 10x faster
	})
})
```

**package.json scripts:**

```json
{
	"scripts": {
		"dev": "vite",
		"build": "vite build",
		"preview": "vite preview",
		"test": "playwright test",
		"test:ui": "playwright test --ui"
	}
}
```

### 8.4 Example 3: Advanced Features

**Custom Transfer Handler Example:**

```typescript
// examples/transferable-advanced/custom-handlers.ts

import { registerTransferHandler, transfer } from "kkrpc"

// Example: Custom video frame class
class VideoFrame {
	constructor(
		public yBuffer: ArrayBuffer,
		public uBuffer: ArrayBuffer,
		public vBuffer: ArrayBuffer,
		public width: number,
		public height: number
	) {}
}

// Register handler for VideoFrame
registerTransferHandler("videoFrame", {
	canHandle: (v): v is VideoFrame => v instanceof VideoFrame,
	serialize: (frame) => [
		{
			width: frame.width,
			height: frame.height,
			yBuffer: frame.yBuffer,
			uBuffer: frame.uBuffer,
			vBuffer: frame.vBuffer
		},
		[frame.yBuffer, frame.uBuffer, frame.vBuffer] // Transfer all buffers
	],
	deserialize: (data) =>
		new VideoFrame(data.yBuffer, data.uBuffer, data.vBuffer, data.width, data.height)
})

// Usage
const frame = new VideoFrame(
	new ArrayBuffer(1920 * 1080), // Y
	new ArrayBuffer(960 * 540), // U
	new ArrayBuffer(960 * 540), // V
	1920,
	1080
)

// Transfer automatically uses custom handler
await api.processVideo(frame) // No need to call transfer() - handler does it
```

---

## 9. Implementation Timeline

### Phase 1: Foundation (Week 1-2)

**Goal:** Establish core transfer infrastructure

**Tasks:**

1. Create `src/transfer.ts` with transfer API
2. Create `src/transfer-handlers.ts` with handler system
3. Update `src/interface.ts` with IoMessage and capabilities
4. Update `src/serialization.ts` with WireEnvelope
5. Implement `processValueForTransfer()` and `reconstructValueFromTransfer()`
6. Write comprehensive unit tests

**Deliverables:**

- [ ] Transfer cache and API
- [ ] Transfer handler system (empty, for custom types only)
- [ ] IoInterface enhancements
- [ ] Wire protocol v2 format
- [ ] Unit tests (>90% coverage)

**Tests:**

- Transfer cache functionality
- Transfer handler registry
- Custom handler support (NOT built-in handlers - those don't exist!)
- processValueForTransfer recursion
- reconstructValueFromTransfer

---

### Phase 2: Adapter Implementation (Week 3)

**Goal:** Enable transfer support in postMessage-based adapters

**Tasks:**

1. Update `src/adapters/worker.ts` (WorkerParentIO, WorkerChildIO)
2. Update `src/adapters/iframe.ts` (IframeParentIO, IframeChildIO)
3. Update `src/adapters/chrome-extension.ts` (ChromePortIO)
4. Add capability detection to all adapters

**Deliverables:**

- [ ] Worker adapters with transfer support
- [ ] Iframe adapters with transfer support
- [ ] Chrome extension adapter with transfer support
- [ ] Capability detection in all adapters
- [ ] Integration tests for each adapter

**Tests:**

- Worker transfer tests (ArrayBuffer, MessagePort)
- Iframe transfer tests
- Chrome extension transfer tests
- Capability detection tests

---

### Phase 3: RPCChannel Integration + Bun Tests (Week 4)

**Goal:** Integrate transfer support into RPC + validate with Bun Workers

**Tasks:**

1. Update `src/channel.ts` with transfer processing
2. Implement argument processing in `callMethod`
3. Implement return value processing in `sendResponse`
4. Handle transferred values in `handleRequest`/`handleResponse`
5. Support transfers in property access and constructors
6. **Create Bun Worker tests** (fast, no UI!)
7. **Create `examples/transferable-demo/`** with Bun example

**Deliverables:**

- [ ] Enhanced RPCChannel with transfer support
- [ ] Argument/return value processing
- [ ] Bidirectional transfer support
- [ ] **Bun Worker tests** (`__tests__/bun-worker-transfer.test.ts`)
- [ ] **Simple Bun example** ready to run
- [ ] Node.js Worker tests for cross-runtime verification

**Tests:**

- ✅ **START HERE:** Bun Worker transfer tests (fast!)
  - ArrayBuffer zero-copy transfer
  - Nested transfers
  - Bidirectional transfers
- Node.js Worker tests (cross-runtime validation)
- Property access with transfers
- Constructor with transfers

**Example Created:**
- `examples/transferable-demo/bun-example.ts` - Run with `bun run bun-example.ts`

---

### Phase 4: Advanced Features (Week 5)

**Goal:** Add convenience features and optimizations

**Tasks:**

1. Add proxy marker support (like Comlink's `proxy()` function)
2. Add transfer statistics/debugging utilities
3. Performance optimizations
4. Documentation for custom transfer handlers
5. Example custom handlers for common patterns

**Deliverables:**

- [ ] Proxy marker support
- [ ] Transfer statistics API
- [ ] Performance benchmarks
- [ ] Custom handler examples (complex objects, circular refs)
- [ ] Debug utilities

**Tests:**

- Proxy marker tests
- Performance benchmarks
- Memory leak tests
- Custom handler integration tests

---

### Phase 5: Browser Example + Tests (Week 6)

**Goal:** Create browser example with Vite + Playwright tests

**Tasks:**

1. **User creates Vite project:** `npm create vite@latest transferable-browser -- --template svelte-ts`
2. Implement browser worker example (Svelte 5 UI)
3. Add performance comparison demo
4. Add ImageBitmap transfer demo
5. **Setup Playwright tests**
6. Verify cross-browser compatibility

**Deliverables:**

- [ ] **Browser example app** (`examples/transferable-browser/`)
  - Interactive UI with transfer demos
  - Real-time performance comparison
  - Log viewer for debugging
- [ ] **Playwright E2E tests**
  - ArrayBuffer transfer test
  - ImageBitmap transfer test  
  - Performance benchmark test
- [ ] Cross-browser testing (Chrome, Firefox, Safari)

**Tests:**

- Browser Worker transfer tests (Playwright)
- ImageBitmap transfer (browser-only feature)
- OffscreenCanvas transfer (browser-only)
- Performance benchmarks (100MB transfer test)
- Manual testing via UI

**Example:**
- Run `pnpm dev` in `examples/transferable-browser/`
- Click buttons to test transfers
- See real-time logs and performance metrics

---

### Phase 6: Documentation & Polish (Week 7)

**Goal:** Complete documentation and ensure production-readiness

**Tasks:**

1. Write API reference documentation
2. Document all examples with README files
3. Write migration guide
4. Performance best practices guide
5. Update main README
6. Create troubleshooting guide

**Deliverables:**

- [ ] Complete API documentation (TypeDoc)
- [ ] Example READMEs with expected output
- [ ] Migration guide (Comlink → kkrpc, existing kkrpc)
- [ ] Performance best practices
- [ ] Updated README with transfer examples
- [ ] All tests passing (Bun, Node.js, Browser)
- [ ] Code review complete

**Documentation:**

- API reference (TypeDoc)
- Bun Worker example README
- Browser example README
- Advanced examples README
- Migration guide
- Performance guide
- Troubleshooting guide

---

## 9. Compatibility Matrix

| Transport            | Transfer Support | Fallback  | Performance Gain  | Notes                      |
| -------------------- | ---------------- | --------- | ----------------- | -------------------------- |
| **Web Worker**       | ✅ Full          | N/A       | 40-100x for 10MB+ | Native postMessage support |
| **Shared Worker**    | ✅ Full          | N/A       | 40-100x for 10MB+ | Native postMessage support |
| **iframe**           | ✅ Full          | N/A       | 40-100x for 10MB+ | Native postMessage support |
| **MessageChannel**   | ✅ Full          | N/A       | 40-100x for 10MB+ | Native postMessage support |
| **Chrome Extension** | ✅ Full          | N/A       | 40-100x for 10MB+ | runtime.Port support       |
| **stdio**            | ❌ No            | Serialize | 1x                | Text-based protocol        |
| **HTTP**             | ❌ No            | Serialize | 1x                | Text-based protocol        |
| **WebSocket**        | ⚠️ Future        | Serialize | 1x                | Binary frames possible     |
| **Socket.IO**        | ⚠️ Future        | Serialize | 1x                | Binary frames possible     |
| **Tauri Shell**      | ❌ No            | Serialize | 1x                | Text-based protocol        |

---

## 10. Migration Guide

### 10.1 From Comlink to kkrpc

```typescript
// =====================================
// Comlink
// =====================================
import * as Comlink from "comlink"

const worker = new Worker("worker.js")
const api = Comlink.wrap(worker)

const buffer = new ArrayBuffer(1024)
await api.processData(Comlink.transfer(buffer, [buffer]))

// =====================================
// kkrpc (equivalent)
// =====================================
import { RPCChannel, WorkerParentIO, transfer } from "kkrpc/browser"

const worker = new Worker("worker.js")
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel(io)
const api = rpc.getAPI()

const buffer = new ArrayBuffer(1024)
await api.processData(transfer(buffer, [buffer]))
```

**Key Differences:**

- kkrpc requires explicit IO adapter creation
- kkrpc supports bidirectional communication out of the box
- kkrpc supports multiple transports beyond postMessage

### 10.2 Upgrading Existing kkrpc Code

```typescript
// =====================================
// Before (no transfer support)
// =====================================
const buffer = new Uint8Array([1, 2, 3]).buffer
await api.processBuffer(buffer) // Serialized (copied)

// =====================================
// After (with transfer support)
// =====================================
import { transfer } from "kkrpc/browser"

const buffer = new Uint8Array([1, 2, 3]).buffer
await api.processBuffer(transfer(buffer, [buffer])) // Transferred (zero-copy)

// Buffer is now neutered
console.log(buffer.byteLength) // 0
```

**Migration Steps:**

1. Update kkrpc to latest version
2. Import `transfer` function
3. Wrap transferable arguments with `transfer(value, [transferables])`
4. Be aware that transferred buffers are neutered after transfer

---

## 11. Best Practices

### 11.1 Understanding Native Transferables

**What Works Automatically:**

The browser natively supports 15+ transferable types. These work automatically when passed to `transfer()`:

- ✅ `ArrayBuffer` - Binary data buffers
- ✅ `MessagePort` - Communication channels
- ✅ `ImageBitmap` - Decoded image data
- ✅ `OffscreenCanvas` - Off-screen canvas rendering
- ✅ `ReadableStream` - Streaming data source
- ✅ `WritableStream` - Streaming data sink
- ✅ `TransformStream` - Stream transformer
- ✅ `AudioData` - Audio frames
- ✅ `VideoFrame` - Video frames
- ✅ `RTCDataChannel` - WebRTC data channel
- ✅ And 5+ more types...

See [MDN: Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)

**When to Use Custom Handlers:**

Only for **non-standard types** that contain transferables:

```typescript
// Example: Custom class containing a transferable buffer
class VideoFrame {
	constructor(
		public buffer: ArrayBuffer,
		public metadata: { width: number; height: number }
	) {}
}

// Need handler because VideoFrame itself isn't transferable
registerTransferHandler("videoFrame", {
	canHandle: (v): v is VideoFrame => v instanceof VideoFrame,
	serialize: (frame) => [{ buffer: frame.buffer, metadata: frame.metadata }, [frame.buffer]],
	deserialize: (data) => new VideoFrame(data.buffer, data.metadata)
})
```

### 11.2 When to Use Transfers

**Use transfers when:**

- ✅ Transferring large binary data (>100KB)
- ✅ Using postMessage-based transports (Workers, iframes)
- ✅ Performance is critical
- ✅ You don't need the original buffer after transfer

**Don't use transfers when:**

- ❌ Data is small (<1KB)
- ❌ You need to reuse the buffer
- ❌ Using text-based transports (HTTP, stdio)
- ❌ Data needs to be shared (use SharedArrayBuffer instead)

### 11.3 Transfer Patterns

**Pattern 1: Simple Transfer**

```typescript
const buffer = new ArrayBuffer(1024)
await api.process(transfer(buffer, [buffer]))
```

**Pattern 2: Nested Transfer**

```typescript
const data = {
	video: videoBuffer,
	audio: audioBuffer,
	metadata: { title: "Movie" }
}
await api.process(transfer(data, [videoBuffer, audioBuffer]))
```

**Pattern 3: Return Value Transfer**

```typescript
// Server side
async function generateLargeData() {
	const buffer = new ArrayBuffer(10_000_000)
	// ... populate buffer
	return transfer(buffer, [buffer])
}

// Client side
const result = await api.generateLargeData()
// result is transferred (zero-copy)
```

**Pattern 4: Bidirectional Transfer**

```typescript
// Send request with transfer
const requestBuffer = new ArrayBuffer(1024)
const responseBuffer = await api.exchange(transfer(requestBuffer, [requestBuffer]))
// Both buffers transferred
```

### 11.4 Error Handling

```typescript
try {
	const buffer = new ArrayBuffer(1024)
	await api.process(transfer(buffer, [buffer]))

	// ⚠️ Buffer is now neutered
	console.log(buffer.byteLength) // 0

	// ❌ Don't try to use the buffer
	// This will fail or produce unexpected results
	const view = new Uint8Array(buffer) // Error or empty view
} catch (error) {
	console.error("Transfer failed:", error)
	// Handle fallback
}
```

### 11.5 Type Safety

```typescript
// Define transfer-aware API types
interface RemoteAPI {
	// Regular method (no transfer)
	process(data: string): Promise<string>

	// Transfer-aware method
	processBuffer(buffer: ArrayBuffer): Promise<number>

	// Return value can be transferred
	generateBuffer(size: number): Promise<ArrayBuffer>
}

// TypeScript will enforce correct usage
const api = rpc.getAPI<RemoteAPI>()

const buffer = new ArrayBuffer(1024)
await api.processBuffer(transfer(buffer, [buffer])) // ✅ Correct

await api.process(transfer("data", [])) // ❌ TypeScript error
```

---

## 12. Success Metrics

### Performance Metrics

- ✅ Transfer 10MB ArrayBuffer in <5ms (vs >100ms for serialization)
- ✅ Zero-copy confirmed (buffer.byteLength === 0 after transfer)
- ✅ <1% overhead for non-transfer messages
- ✅ <1ms average latency for small messages

### Compatibility Metrics

- ✅ All existing tests pass (100% backward compatible)
- ✅ All transports maintain compatibility
- ✅ Graceful degradation for non-transfer transports
- ✅ Cross-browser compatibility (Chrome, Firefox, Safari, Edge)

### Usability Metrics

- ✅ API similar to Comlink (easy migration)
- ✅ TypeScript types maintain safety
- ✅ Clear error messages
- ✅ Comprehensive documentation
- ✅ >90% test coverage

---

## 13. Risk Analysis

### High Risks

1. **Breaking Changes** - Modifying core interfaces

   - **Mitigation:** Union types in IoInterface, backward-compatible wire format, extensive testing
   - **Status:** ✅ Mitigated

2. **Performance Regression** - Overhead in non-transfer cases
   - **Mitigation:** Lazy evaluation, performance benchmarks, conditional compilation
   - **Status:** ✅ Mitigated

### Medium Risks

1. **Browser Compatibility** - Different transfer behavior across browsers

   - **Mitigation:** Extensive cross-browser testing, feature detection, graceful fallback
   - **Status:** ⚠️ Requires testing

2. **Memory Leaks** - Transfer cache not cleaned up
   - **Mitigation:** WeakMap usage (automatic GC), explicit cleanup APIs
   - **Status:** ✅ Mitigated

### Low Risks

1. **API Confusion** - Users forgetting to call transfer()

   - **Mitigation:** Clear documentation, TypeScript hints, warning messages
   - **Status:** ✅ Mitigated

2. **Edge Cases** - Circular references, special object types
   - **Mitigation:** Comprehensive test coverage, error handling
   - **Status:** ⚠️ Requires testing

---

## 14. Implementation Summary

### Timeline Overview

| Phase | Duration | Focus | Key Deliverables |
|-------|----------|-------|------------------|
| **Phase 1** | 2 weeks | Foundation | Core APIs, WireEnvelope, IoMessage, Unit Tests |
| **Phase 2** | 1 week | Adapters | Worker/iframe/MessageChannel adapter updates |
| **Phase 3** | 1 week | Integration + Tests | RPCChannel integration + **Bun Worker tests** |
| **Phase 4** | 1 week | Advanced | Custom handlers + **Node.js tests** |
| **Phase 5** | 1 week | Browser | **Vite + Svelte 5 example** + **Playwright tests** |
| **Phase 6** | 1 week | Polish | Documentation, READMEs, migration guide |
| **Total** | **7 weeks** | | **Full implementation with comprehensive testing** |

### Testing Progression Strategy

**Why This Order:**
1. 🚀 **Fastest to slowest** - Bun → Node.js → Browser
2. 🎯 **Simple to complex** - No UI → Interactive UI
3. ✅ **Quick validation** - Catch issues early without browser overhead
4. 🔄 **Cross-runtime** - Verify behavior across all environments

**Testing Flow:**

```
Week 1-2: Unit Tests (no workers)
    ↓
Week 4: Bun Worker Tests ← START HERE (fast, no UI, easy debugging)
    ↓
Week 5: Node.js Worker Tests (cross-runtime validation)
    ↓
Week 6: Browser Tests (Playwright + manual testing)
    ↓
Week 7: Polish & final validation
```

### Examples Created

1. **`examples/transferable-demo/`** (Week 4)
   - Bun Worker example
   - Node.js Worker example
   - Quick CLI testing
   - Expected output samples

2. **`examples/transferable-browser/`** (Week 6)
   - Vite + Svelte 5 UI
   - Interactive performance demos
   - Real-time logging
   - Playwright E2E tests
   - Manual testing interface

3. **`examples/transferable-advanced/`** (Optional)
   - Custom transfer handlers
   - Streaming examples
   - Performance comparisons

---

## 15. Future Enhancements

### Phase 2 Features (Beyond 7 weeks)

1. **WebSocket Binary Frames**

   - Add binary frame support for WebSocket adapter
   - Enable zero-copy transfers over WebSocket
   - Implement frame splitting for large buffers

2. **SharedArrayBuffer Support**

   - Integrate SharedArrayBuffer for shared memory
   - Atomic operations across threads
   - Memory pool management

3. **Streaming Transfers**

   - Support streaming large buffers in chunks
   - Progress callbacks
   - Cancellation support

4. **Compression**

   - Compress serialized data before transfer
   - LZ4/Snappy integration
   - Adaptive compression based on size

5. **Transfer Pool**
   - Reusable buffer pool
   - Automatic buffer allocation/deallocation
   - Memory usage optimization

---

## 16. Conclusion

This implementation plan provides a **production-ready roadmap** for adding transferable object support to kkrpc. The design combines:

✅ **Clean Architecture** - WireEnvelope and IoMessage patterns  
✅ **Backward Compatibility** - Existing code continues to work  
✅ **Multi-Transport Support** - Graceful fallback for all transports  
✅ **Type Safety** - Full TypeScript support  
✅ **Performance** - 40-100x faster for large binary data  
✅ **Extensibility** - Custom transfer handlers  
✅ **Comprehensive Testing** - Unit, Bun, Node.js, Browser (Playwright)  
✅ **Clear Documentation** - API reference, examples, migration guide  
✅ **Practical Examples** - Bun CLI example + Svelte 5 browser demo

**Timeline:** 7 weeks (including comprehensive testing & examples)  
**Breaking Changes:** None  
**Risk Level:** Low-Medium  
**Performance Gain:** 40-100x for large transfers

### Testing Strategy Highlights

The plan includes a **progressive testing strategy** that ensures quality without sacrificing development speed:

1. **Week 4:** Start with **Bun Workers** (fast, no UI, easy debugging)
2. **Week 5:** Validate with **Node.js Workers** (cross-runtime)
3. **Week 6:** Real-world testing with **Browser + Playwright** (production-like)

This approach catches issues early while minimizing the overhead of browser-based testing during development.

### Implementation Impact

The implementation will significantly improve kkrpc's performance for browser-based communication while maintaining its core strengths: multi-transport flexibility, bidirectional communication, and developer experience. The addition of practical examples (both CLI and browser-based) ensures developers can quickly understand and adopt the new transferable objects feature.

---

**Document Version:** 1.2 (Final)  
**Date:** October 25, 2025  
**Status:** Ready for Implementation  
**Review Status:** Approved

### Version History

- **v1.0** (Initial) - Comprehensive transferable objects implementation plan
- **v1.1** (Simplification) - Removed overengineered built-in handlers for native types
- **v1.2** (Testing & Examples) - Added progressive testing strategy (Bun → Node.js → Browser) and comprehensive example applications
