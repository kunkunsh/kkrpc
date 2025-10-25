/**
 * Transferable Objects Support for kkrpc
 * 
 * This module provides utilities for detecting, validating, and handling
 * Transferable objects in browser environments according to web standards.
 */

/**
 * Type guard to check if a value is a Transferable object
 * according to the HTML specification.
 * 
 * Transferable objects include:
 * - ArrayBuffer
 * - MessagePort
 * - ImageBitmap
 * - OffscreenCanvas
 * - ReadableStream
 * - WritableStream
 * - TransformStream
 * - AudioData
 * - VideoFrame
 * - MediaSourceHandle (Chrome)
 * - FileSystemWritableFileStream (Chrome)
 * - GPUBuffer (Chrome)
 * - GPUTexture (Chrome)
 * - CanvasGradient (Firefox)
 * - CanvasPattern (Firefox)
 * - ImageData (Firefox)
 * 
 * @param value - The value to check
 * @returns True if the value is a Transferable object
 */
export function isTransferable(value: unknown): value is Transferable {
	if (value === null || value === undefined) {
		return false
	}

	// Check for standard transferable objects
	if (value instanceof ArrayBuffer) {
		return true
	}

	if (typeof MessagePort !== 'undefined' && value instanceof MessagePort) {
		return true
	}

	if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) {
		return true
	}

	if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) {
		return true
	}

	if (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream) {
		return true
	}

	if (typeof WritableStream !== 'undefined' && value instanceof WritableStream) {
		return true
	}

	if (typeof TransformStream !== 'undefined' && value instanceof TransformStream) {
		return true
	}

	// Check for newer transferable objects
	if (typeof AudioData !== 'undefined' && value instanceof AudioData) {
		return true
	}

	if (typeof VideoFrame !== 'undefined' && value instanceof VideoFrame) {
		return true
	}

	// Chrome-specific transferables
	if (typeof MediaSourceHandle !== 'undefined' && value instanceof MediaSourceHandle) {
		return true
	}

	if (typeof FileSystemWritableFileStream !== 'undefined' && 
		value instanceof FileSystemWritableFileStream) {
		return true
	}

	// WebGPU transferables (Chrome)
	if (typeof GPUBuffer !== 'undefined' && value instanceof GPUBuffer) {
		return true
	}

	if (typeof GPUTexture !== 'undefined' && value instanceof GPUTexture) {
		return true
	}

	// Firefox-specific transferables
	if (typeof CanvasGradient !== 'undefined' && value instanceof CanvasGradient) {
		return true
	}

	if (typeof CanvasPattern !== 'undefined' && value instanceof CanvasPattern) {
		return true
	}

	if (typeof ImageData !== 'undefined' && value instanceof ImageData) {
		return true
	}

	return false
}

/**
 * Type guard to check if a value is an ArrayBuffer
 * @param value - The value to check
 * @returns True if the value is an ArrayBuffer
 */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
	return value instanceof ArrayBuffer
}

/**
 * Type guard to check if a value is a MessagePort
 * @param value - The value to check
 * @returns True if the value is a MessagePort
 */
export function isMessagePort(value: unknown): value is MessagePort {
	return typeof MessagePort !== 'undefined' && value instanceof MessagePort
}

/**
 * Type guard to check if a value is an ImageBitmap
 * @param value - The value to check
 * @returns True if the value is an ImageBitmap
 */
export function isImageBitmap(value: unknown): value is ImageBitmap {
	return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap
}

/**
 * Type guard to check if a value is an OffscreenCanvas
 * @param value - The value to check
 * @returns True if the value is an OffscreenCanvas
 */
export function isOffscreenCanvas(value: unknown): value is OffscreenCanvas {
	return typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas
}

/**
 * Type guard to check if a value is a ReadableStream
 * @param value - The value to check
 * @returns True if the value is a ReadableStream
 */
export function isReadableStream(value: unknown): value is ReadableStream {
	return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream
}

/**
 * Type guard to check if a value is a WritableStream
 * @param value - The value to check
 * @returns True if the value is a WritableStream
 */
export function isWritableStream(value: unknown): value is WritableStream {
	return typeof WritableStream !== 'undefined' && value instanceof WritableStream
}

/**
 * Type guard to check if a value is a TransformStream
 * @param value - The value to check
 * @returns True if the value is a TransformStream
 */
export function isTransformStream(value: unknown): value is TransformStream {
	return typeof TransformStream !== 'undefined' && value instanceof TransformStream
}

/**
 * Extracts all transferable objects from a value recursively
 * @param value - The value to extract transferables from
 * @returns Array of transferable objects found
 */
export function extractTransferables(value: unknown): Transferable[] {
	const transferables: Transferable[] = []
	const visited = new WeakSet()

	function extract(obj: unknown): void {
		if (obj === null || obj === undefined) {
			return
		}

		// Avoid circular references
		if (typeof obj === 'object' && visited.has(obj)) {
			return
		}

		if (isTransferable(obj)) {
			transferables.push(obj)
			return
		}

		// Recursively check arrays
		if (Array.isArray(obj)) {
			visited.add(obj)
			for (const item of obj) {
				extract(item)
			}
			return
		}

		// Recursively check objects
		if (typeof obj === 'object' && obj !== null) {
			visited.add(obj)
			for (const key in obj) {
				if (Object.prototype.hasOwnProperty.call(obj, key)) {
					extract((obj as any)[key])
				}
			}
		}
	}

	extract(value)
	return transferables
}

/**
 * Validates that all items in an array are transferable objects
 * @param transferables - Array of objects to validate
 * @returns True if all objects are transferable
 * @throws Error if any object is not transferable
 */
export function validateTransferables(transferables: unknown[]): transferables is Transferable[] {
	for (let i = 0; i < transferables.length; i++) {
		const item = transferables[i]
		if (!isTransferable(item)) {
			const constructorName = item && typeof item === 'object' && 'constructor' in item
				? (item as any).constructor?.name || 'unknown'
				: typeof item
			throw new Error(
				`Object at index ${i} is not transferable: ${typeof item} (${constructorName})`
			)
		}
	}
	return true
}

/**
 * Checks if the current environment supports transferable objects
 * @returns True if transferable objects are supported
 */
export function isTransferableSupported(): boolean {
	// Check for ArrayBuffer support (minimum requirement)
	if (typeof ArrayBuffer === 'undefined') {
		return false
	}

	// Check for browser environment
	if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
		return true
	}

	// Check for worker environment (Bun, Node.js with worker_threads, Deno)
	if (typeof self !== 'undefined' && typeof postMessage === 'function') {
		return true
	}

	// Check for Node.js with worker_threads
	if (typeof process !== 'undefined' &&
		process.versions &&
		process.versions.node &&
		typeof globalThis !== 'undefined' &&
		(globalThis as any).process?.versions?.node) {
		try {
			// Use dynamic import to avoid bundler issues
			const workerThreads = eval('typeof require !== "undefined" ? require("worker_threads") : null');
			if (workerThreads?.Worker) {
				return true;
			}
		} catch {
			// Ignore errors, just return false
		}
	}

	return false
}

/**
 * Filters an array to only include transferable objects
 * @param items - Array of objects to filter
 * @returns Array containing only transferable objects
 */
export function filterTransferables(items: unknown[]): Transferable[] {
	return items.filter(isTransferable)
}

/**
 * Creates a transferable object wrapper for performance optimization
 * This helps identify objects that should be transferred rather than copied
 * 
 * @param obj - The object to wrap
 * @param transferables - Array of transferable objects associated with the object
 * @returns Wrapped object with transfer metadata
 */
export function createTransferableWrapper<T>(
	obj: T,
	transferables: Transferable[]
): { data: T; transferables: Transferable[] } {
	return {
		data: obj,
		transferables: [...transferables]
	}
}

/**
 * Performance metrics for transfer operations
 */
export interface TransferMetrics {
	totalObjects: number
	transferableObjects: number
	transferRatio: number
	estimatedMemorySavings: number
}

/**
 * Analyzes a value for transferability and provides performance metrics
 * @param value - The value to analyze
 * @returns Performance metrics for the transfer operation
 */
export function analyzeTransferability(value: unknown): TransferMetrics {
	const transferables = extractTransferables(value)
	const totalObjects = countObjects(value)
	const transferableObjects = transferables.length
	const transferRatio = totalObjects > 0 ? transferableObjects / totalObjects : 0

	// Estimate memory savings (rough approximation)
	let estimatedMemorySavings = 0
	for (const transferable of transferables) {
		if (transferable instanceof ArrayBuffer) {
			estimatedMemorySavings += transferable.byteLength
		}
		// Add estimates for other transferable types as needed
	}

	return {
		totalObjects,
		transferableObjects,
		transferRatio,
		estimatedMemorySavings
	}
}

/**
 * Counts the total number of objects in a value recursively
 * @param value - The value to count objects in
 * @returns Total number of objects
 */
function countObjects(value: unknown): number {
	let objectCount = 0
	const visited = new WeakSet()

	function count(obj: unknown): void {
		if (obj === null || obj === undefined) {
			return
		}

		// Avoid circular references
		if (typeof obj === 'object' && visited.has(obj)) {
			return
		}

		if (typeof obj === 'object' && obj !== null) {
			objectCount++
			visited.add(obj)

			if (Array.isArray(obj)) {
				for (const item of obj) {
					count(item)
				}
			} else {
				for (const key in obj) {
					if (Object.prototype.hasOwnProperty.call(obj, key)) {
						count((obj as any)[key])
					}
				}
			}
		}
	}

	count(value)
	return objectCount
}