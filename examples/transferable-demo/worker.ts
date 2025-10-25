/**
 * Worker example demonstrating Transferable Objects usage with kkrpc
 * This worker processes large data buffers efficiently using zero-copy transfers
 */

import { RPCChannel } from 'kkrpc'
import { WorkerChildIO } from 'kkrpc'
import {
	isTransferable,
	analyzeTransferability,
	extractTransferables
} from 'kkrpc'

// Create RPC channel for worker
const io = new WorkerChildIO()
const rpc = new RPCChannel(io, {
	expose: {
		// Process large ArrayBuffer with zero-copy transfer
		processLargeBuffer: async (buffer: ArrayBuffer, metadata: any) => {
			console.log(`Worker: Received buffer of size: ${buffer.byteLength} bytes`)
			console.log(`Worker: Metadata:`, metadata)
			
			// Simulate processing time
			await new Promise(resolve => setTimeout(resolve, 100))
			
			// Process the buffer (in real scenario, this could be image processing, 
			// audio analysis, data compression, etc.)
			const view = new Uint8Array(buffer)
			let sum = 0
			for (let i = 0; i < view.length; i++) {
				sum += view[i]
			}
			
			// Create a new buffer for the result
			const resultBuffer = new ArrayBuffer(8)
			const resultView = new DataView(resultBuffer)
			resultView.setUint32(0, view.length, true) // original size
			resultView.setUint32(4, sum, true) // checksum
			
			// Return result with transferable buffer
			return {
				processed: true,
				originalSize: buffer.byteLength,
				checksum: sum,
				resultBuffer: resultBuffer
			}
		},

		// Process multiple buffers in batch
		processBatch: async (buffers: ArrayBuffer[], operations: string[]) => {
			console.log(`Worker: Processing batch of ${buffers.length} buffers`)
			
			const results: any[] = []
			
			for (let i = 0; i < buffers.length; i++) {
				const buffer = buffers[i]
				const operation = operations[i] || 'sum'
				
				console.log(`Worker: Processing buffer ${i + 1} with operation: ${operation}`)
				
				let result
				switch (operation) {
					case 'sum':
						const view = new Uint8Array(buffer)
						let sum = 0
						for (let j = 0; j < view.length; j++) {
							sum += view[j]
						}
						result = { sum, size: buffer.byteLength }
						break
					
					case 'average':
						const avgView = new Uint8Array(buffer)
						let avgSum = 0
						for (let j = 0; j < avgView.length; j++) {
							avgSum += avgView[j]
						}
						result = { 
							average: avgSum / avgView.length, 
							size: buffer.byteLength 
						}
						break
					
					case 'minmax':
						const mmView = new Uint8Array(buffer)
						let min = 255
						let max = 0
						for (let j = 0; j < mmView.length; j++) {
							if (mmView[j] < min) min = mmView[j]
							if (mmView[j] > max) max = mmView[j]
						}
						result = { min, max, size: buffer.byteLength }
						break
					
					default:
						result = { error: 'Unknown operation', size: buffer.byteLength }
				}
				
				results.push(result)
			}
			
			return {
				processed: true,
				count: buffers.length,
				results
			}
		},

		// Analyze transferability of incoming data
		analyzeData: async (data: any) => {
			console.log('Worker: Analyzing data transferability')
			
			const metrics = analyzeTransferability(data)
			const transferables = extractTransferables(data)
			
			return {
				metrics,
				transferableCount: transferables.length,
				transferableTypes: transferables.map(t => t.constructor.name),
				environmentSupport: {
					transferablesSupported: typeof ArrayBuffer !== 'undefined',
					messagePortSupported: typeof MessagePort !== 'undefined',
					offscreenCanvasSupported: typeof OffscreenCanvas !== 'undefined'
				}
			}
		},

		// Process image data (simulated)
		processImage: async (imageBuffer: ArrayBuffer, width: number, height: number) => {
			console.log(`Worker: Processing image ${width}x${height} (${imageBuffer.byteLength} bytes)`)
			
			// Simulate image processing
			await new Promise(resolve => setTimeout(resolve, 200))
			
			// Create a simple grayscale conversion (simulated)
			const pixels = new Uint8ClampedArray(imageBuffer)
			const grayscale = new Uint8ClampedArray(pixels.length / 4) // RGBA to grayscale
			
			for (let i = 0; i < pixels.length; i += 4) {
				// Simple grayscale formula: 0.299*R + 0.587*G + 0.114*B
				const gray = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2])
				grayscale[i / 4] = gray
			}
			
			// Create result buffer
			const resultBuffer = grayscale.buffer
			
			return {
				processed: true,
				originalSize: imageBuffer.byteLength,
				resultSize: resultBuffer.byteLength,
				width,
				height,
				resultBuffer
			}
		},

		// Echo back transferables for testing
		echoTransferables: async (...args: any[]) => {
			console.log('Worker: Echoing back transferables')
			
			const transferables = extractTransferables(args)
			console.log(`Worker: Found ${transferables.length} transferables`)
			
			return {
				receivedArgs: args.length,
				transferablesFound: transferables.length,
				transferableTypes: transferables.map(t => t.constructor.name),
				args: args.map(arg => {
					if (isTransferable(arg)) {
						return { 
							type: 'transferable', 
							constructor: arg.constructor.name,
							size: arg.byteLength || 'unknown'
						}
					}
					return { type: 'regular', value: arg }
				})
			}
		}
	}
})

console.log('Worker: Transferable demo worker ready')