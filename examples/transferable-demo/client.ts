/**
 * Client example demonstrating Transferable Objects usage with kkrpc
 * This client sends large data buffers to worker for efficient processing
 */

import { RPCChannel } from 'kkrpc'
import { WorkerParentIO } from 'kkrpc'
import {
	isTransferable,
	analyzeTransferability,
	extractTransferables,
	createTransferableWrapper,
	transfer
} from 'kkrpc'

// Create worker and RPC channel
const worker = new Worker('./worker.ts')
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel(io)

async function demonstrateTransferables() {
	console.log('=== Transferable Objects Demo ===')
	
	// Demo 1: Large buffer processing
	console.log('\n1. Processing large buffer with transferables...')
	const largeBuffer = new ArrayBuffer(1024 * 1024) // 1MB
	const view = new Uint8Array(largeBuffer)
	
	// Fill with test data
	for (let i = 0; i < view.length; i++) {
		view[i] = i % 256
	}
	
	console.log(`Created buffer of size: ${largeBuffer.byteLength} bytes`)
	console.log(`Buffer is transferable: ${isTransferable(largeBuffer)}`)
	
	// Analyze transferability
	const metrics = analyzeTransferability({ buffer: largeBuffer })
	console.log(`Transfer ratio: ${(metrics.transferRatio * 100).toFixed(1)}%`)
	console.log(`Estimated memory savings: ${(metrics.estimatedMemorySavings / 1024).toFixed(1)} KB`)
	
	try {
		// Mark the buffer for transfer
		const result = await rpc.getAPI().processLargeBuffer(
			transfer(largeBuffer, [largeBuffer]),
			{
				type: 'test-data',
				timestamp: Date.now()
			}
		)
		
		// Handle wrapped response
		const actualResult = result.value || result
		
		console.log('Processing result:', actualResult)
		console.log(`Original size: ${actualResult.originalSize} bytes`)
		console.log(`Checksum: ${actualResult.checksum}`)
		
		// Buffer should be empty after transfer
		console.log(`Buffer size after transfer: ${largeBuffer.byteLength} bytes`)
	} catch (error) {
		console.error('Error processing large buffer:', error)
	}
	
	// Demo 2: Batch processing
	console.log('\n2. Batch processing with multiple transferables...')
	const buffers = Array.from({ length: 5 }, (_, i) => {
		const buffer = new ArrayBuffer(1024 * (i + 1)) // Different sizes
		const view = new Uint8Array(buffer)
		view.fill(i + 1) // Fill with pattern
		return buffer
	})
	
	const operations = ['sum', 'average', 'minmax', 'sum', 'average']
	
	try {
		// Mark all buffers for transfer
		const batchResult = await rpc.getAPI().processBatch(
			transfer(buffers, buffers),
			operations
		)
		
		// Handle wrapped response
		const actualResult = batchResult.value || batchResult
		
		console.log('Batch processing result:', actualResult)
		console.log(`Processed ${actualResult.count} buffers`)
		actualResult.results.forEach((result: any, index: number) => {
			console.log(`  Buffer ${index + 1}:`, result)
		})
	} catch (error) {
		console.error('Error in batch processing:', error)
	}
	
	// Demo 3: Transferable wrapper
	console.log('\n3. Using transferable wrapper...')
	const wrapperBuffer = new ArrayBuffer(2048)
	const wrapper = createTransferableWrapper(
		{ data: 'wrapped data', size: wrapperBuffer.byteLength },
		[wrapperBuffer]
	)
	
	try {
		const wrapperResult = await rpc.getAPI().analyzeData(wrapper)
		
		// Handle wrapped response
		const actualResult = wrapperResult.value || wrapperResult
		
		console.log('Wrapper analysis result:', actualResult)
		console.log(`Transferables found: ${actualResult.transferableCount}`)
		console.log(`Transferable types: ${actualResult.transferableTypes.join(', ')}`)
	} catch (error) {
		console.error('Error analyzing wrapper:', error)
	}
	
	// Demo 4: Mixed transferable and non-transferable data
	console.log('\n4. Mixed data with transferables...')
	const mixedData = {
		transferableBuffer: new ArrayBuffer(512),
		regularString: 'This is a regular string',
		regularNumber: 42,
		regularObject: { nested: { value: 'test' } },
		anotherBuffer: new ArrayBuffer(256)
	}
	
	// Fill buffers with test data
	const mixedView1 = new Uint8Array(mixedData.transferableBuffer)
	mixedView1.fill(128)
	const mixedView2 = new Uint8Array(mixedData.anotherBuffer)
	mixedView2.fill(64)
	
	const mixedMetrics = analyzeTransferability(mixedData)
	console.log('Mixed data analysis:')
	console.log(`  Total objects: ${mixedMetrics.totalObjects}`)
	console.log(`  Transferable objects: ${mixedMetrics.transferableObjects}`)
	console.log(`  Transfer ratio: ${(mixedMetrics.transferRatio * 100).toFixed(1)}%`)
	
	try {
		const mixedResult = await rpc.getAPI().echoTransferables(
			transfer(mixedData.transferableBuffer, [mixedData.transferableBuffer]),
			mixedData.regularString,
			mixedData.regularNumber,
			mixedData.regularObject,
			transfer(mixedData.anotherBuffer, [mixedData.anotherBuffer])
		)
		
		// Handle wrapped response
		const actualResult = mixedResult.value || mixedResult
		
		console.log('Echo result:', actualResult)
		console.log(`Received args: ${actualResult.receivedArgs}`)
		console.log(`Transferables found: ${actualResult.transferablesFound}`)
		actualResult.args.forEach((arg: any, index: number) => {
			console.log(`  Arg ${index + 1}: ${arg.type} - ${arg.constructor || 'N/A'}`)
		})
	} catch (error) {
		console.error('Error with mixed data:', error)
	}
	
	// Demo 5: Performance comparison
	console.log('\n5. Performance comparison...')
	const sizes = [1024, 10240, 102400, 1024000] // 1KB, 10KB, 100KB, 1MB
	
	for (const size of sizes) {
		const perfBuffer = new ArrayBuffer(size)
		const perfView = new Uint8Array(perfBuffer)
		perfView.fill(Math.random() * 256)
		
		const startTime = performance.now()
		// Mark the buffer for transfer
		await rpc.getAPI().processLargeBuffer(
			transfer(perfBuffer, [perfBuffer]),
			{ size }
		)
		const endTime = performance.now()
		
		console.log(`Size: ${(size / 1024).toFixed(1)}KB, Time: ${(endTime - startTime).toFixed(2)}ms`)
	}
	
	console.log('\n=== Demo Complete ===')
}

// Run the demonstration
demonstrateTransferables().catch(console.error)

// Handle cleanup
process.on('SIGINT', () => {
	console.log('\nShutting down worker...')
	worker.terminate()
	process.exit(0)
})