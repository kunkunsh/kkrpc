# Transferable Objects Demo

This example demonstrates how to use kkrpc's Transferable Objects support for efficient zero-copy data transfers between browser contexts.

## Overview

Transferable Objects allow you to transfer large data structures between contexts (like main thread and workers, or between windows/iframes) without making copies, resulting in significant performance improvements.

## Features Demonstrated

- **Automatic Transferable Detection**: kkrpc automatically detects and extracts transferable objects
- **Manual Transferable Marking**: Explicitly mark objects for transfer using `transfer()` function
- **Performance Analysis**: Analyze transferability metrics for optimization
- **Batch Processing**: Efficiently handle multiple transferable objects
- **Mixed Data Handling**: Process both transferable and regular data together
- **Error Handling**: Graceful handling of invalid transferables

## Running the Demo

### Prerequisites

- Node.js 18+ or Bun
- TypeScript 5+
- Modern browser environment (for transferable support)

### Setup

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

### Run the Demo

```bash
# Start the demo
npm run dev
```

## Demo Scenarios

### 1. Large Buffer Processing

Transfers a 1MB ArrayBuffer to worker for processing:

```typescript
const largeBuffer = new ArrayBuffer(1024 * 1024) // 1MB
const result = await rpc.getAPI().processLargeBuffer(largeBuffer, metadata)
```

**Benefits**: Zero-copy transfer saves 1MB of memory allocation

### 2. Batch Processing

Processes multiple buffers with different operations:

```typescript
const buffers = [buffer1, buffer2, buffer3]
const operations = ['sum', 'average', 'minmax']
const results = await rpc.getAPI().processBatch(buffers, operations)
```

**Benefits**: Efficient handling of multiple transferables in single call

### 3. Transferable Wrapper

Explicitly wraps data with transferables:

```typescript
const wrapper = createTransferableWrapper(data, [buffer])
const result = await rpc.getAPI().analyzeData(wrapper)
```

**Benefits**: Clear intent and metadata about transferables

### 4. Mixed Data Handling

Processes both transferable and regular data:

```typescript
const mixedData = {
  transferableBuffer: new ArrayBuffer(512),
  regularString: 'regular data',
  regularObject: { nested: 'value' }
}
```

**Benefits**: Automatic extraction of transferables from complex objects

### 5. Performance Comparison

Compares performance across different data sizes:

```typescript
const sizes = [1024, 10240, 102400, 1024000] // 1KB to 1MB
// Measures transfer time for each size
```

**Benefits**: Understanding performance characteristics

## Key Concepts

### Transferable Objects

These are objects that can be transferred between contexts without copying:

- `ArrayBuffer` - Raw binary data
- `MessagePort` - Communication channel
- `ImageBitmap` - Bitmap image data
- `OffscreenCanvas` - Canvas rendering context
- `ReadableStream`/`WritableStream`/`TransformStream` - Stream objects
- And more browser-specific types

### Zero-Copy Transfer

When an object is transferred:
- Original context loses access to the object
- Receiving context gains ownership
- No memory copy is performed
- Significant performance improvement for large data

### Automatic Detection

kkrpc automatically:
- Detects transferable objects in method arguments
- Extracts them for efficient transfer
- Validates transferables before sending
- Handles errors gracefully

## Performance Tips

### 1. Use Transferables for Large Data

```typescript
// Good - large buffer benefits from transfer
const largeBuffer = new ArrayBuffer(10 * 1024 * 1024) // 10MB

// Less beneficial - small data doesn't need transfer
const smallBuffer = new ArrayBuffer(100) // 100 bytes
```

### 2. Analyze Before Transfer

```typescript
const metrics = analyzeTransferability(data)
if (metrics.transferRatio > 0.3) {
  // Good candidate for transferable optimization
  await rpc.getAPI().processData(data)
}
```

### 3. Batch Multiple Transferables

```typescript
// Good - single call with multiple transferables
await rpc.getAPI().processBatch([buffer1, buffer2, buffer3])

// Less efficient - multiple calls
await rpc.getAPI().processData(buffer1)
await rpc.getAPI().processData(buffer2)
await rpc.getAPI().processData(buffer3)
```

### 4. Handle Transferred Objects

```typescript
const buffer = new ArrayBuffer(1024)
await rpc.getAPI().processData(buffer)

// Buffer is now empty (transferred away)
console.log(buffer.byteLength) // 0

// Create new buffer if needed
const newBuffer = new ArrayBuffer(1024)
```

## Browser Compatibility

### Supported Browsers

- **Chrome**: Full support for all transferable types
- **Firefox**: Support for core transferables + Firefox-specific types
- **Safari**: Support for core transferables
- **Edge**: Full support (Chromium-based)

### Feature Detection

```typescript
if (isTransferableSupported()) {
  // Transferables available
  await rpc.getAPI().processData(buffer)
} else {
  // Fallback to regular serialization
  await rpc.getAPI().processData(buffer)
}
```

## Error Handling

### Common Issues

1. **"Object is not transferable"**
   - Ensure object is a valid transferable type
   - Check browser compatibility

2. **Transfered object becomes empty**
   - This is expected behavior
   - Use object in receiving context

3. **Performance not improving**
   - Check data size (small data may not benefit)
   - Analyze transferability metrics

### Debug Tips

```typescript
// Enable transferability analysis
const metrics = analyzeTransferability(data)
console.log(`Transfer ratio: ${metrics.transferRatio}`)
console.log(`Memory savings: ${metrics.estimatedMemorySavings} bytes`)

if (metrics.transferRatio < 0.1) {
  console.warn('Low transferability - consider restructuring data')
}
```

## Advanced Usage

### Custom Transferable Detection

```typescript
// Check specific transferable types
if (isArrayBuffer(data)) {
  // Handle ArrayBuffer specifically
}

if (isMessagePort(data)) {
  // Handle MessagePort specifically
}
```

### Transferable Validation

```typescript
try {
  validateTransferables([buffer1, buffer2])
  // All objects are transferable
} catch (error) {
  console.error('Invalid transferables:', error.message)
}
```

### Performance Monitoring

```typescript
const startTime = performance.now()
await rpc.getAPI().processLargeData(buffer)
const endTime = performance.now()

console.log(`Transfer time: ${endTime - startTime}ms`)
console.log(`Data size: ${buffer.byteLength} bytes`)
console.log(`Throughput: ${(buffer.byteLength / (endTime - startTime) * 1000).toFixed(2)} bytes/sec`)
```

## Files

- `worker.ts` - Worker implementation with transferable processing
- `client.ts` - Client demonstrating transferable usage
- `package.json` - Project configuration
- `README.md` - This documentation

## Further Reading

- [Transferable Objects MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [kkrpc Transferable Objects Documentation](../../../packages/kkrpc/docs/transferable-objects.md)
- [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)

## Contributing

To extend this demo or add new examples:

1. Fork the repository
2. Create a new branch
3. Add your example
4. Update documentation
5. Submit a pull request

## License

This example is part of the kkrpc project and follows the same license terms.
