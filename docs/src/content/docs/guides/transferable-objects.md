---
title: Transferable Objects
description: Zero-copy data transfers for high-performance RPC communication
---

# Transferable Objects

Transferable objects enable **zero-copy** data transfers between different contexts (main thread, web workers, iframes) in browsers. Instead of copying large amounts of data—which can be slow and memory-intensive—ownership of data is transferred directly.

## 🚀 Why Use Transferable Objects?

### Performance Benefits

| Buffer Size | Traditional Copy | Transferable | Speedup |
|-------------|------------------|---------------|-----------|
| 1MB         | ~15ms           | ~2ms          | **7.5x**  |
| 10MB        | ~150ms          | ~3ms          | **50x**    |
| 100MB       | ~1500ms         | ~15ms         | **100x**   |

### Memory Efficiency

- **No duplication**: Data ownership moves without creating copies
- **Lower memory pressure**: Especially important for large files/media
- **Garbage collection friendly**: Transferred objects are automatically cleaned up

## 📋 Supported Transferable Types

Browser natively supports these transferable types:

| Type | Description | Use Case |
|-------|-------------|-----------|
| `ArrayBuffer` | Raw binary data | File uploads, image processing, audio/video data |
| `MessagePort` | Communication channel | Multi-worker coordination |
| `ImageBitmap` | Decoded image data | Image processing, canvas rendering |
| `OffscreenCanvas` | Off-screen rendering | Graphics processing, filters |
| `ReadableStream` | Streaming data source | File downloads, real-time data |
| `WritableStream` | Streaming data sink | File uploads, data processing |
| `TransformStream` | Stream transformer | Data compression, encryption |
| `AudioData` | Audio frame data | Audio processing, analysis |
| `VideoFrame` | Video frame data | Video processing, streaming |
| `RTCDataChannel` | WebRTC data channel | Peer-to-peer communication |

[See MDN for complete list](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)

## 🛠️ Basic Usage

### Simple Transfer

```typescript
import { RPCChannel, WorkerParentIO, transfer } from "kkrpc/browser"

// Setup RPC channel
const worker = new Worker("worker.js")
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel(io)
const api = rpc.getAPI<{
  processBuffer(buffer: ArrayBuffer): Promise<number>
}>()

// Create buffer to transfer
const buffer = new ArrayBuffer(10 * 1024 * 1024) // 10MB
console.log("Before:", buffer.byteLength) // 10485760

// Transfer with zero-copy
await api.processBuffer(transfer(buffer, [buffer]))

// Buffer is now neutered (ownership transferred)
console.log("After:", buffer.byteLength) // 0
```

### Nested Transfer

```typescript
// Transfer multiple buffers in a single call
const videoBuffer = new ArrayBuffer(1920 * 1080 * 4) // RGBA video frame
const audioBuffer = new ArrayBuffer(44100 * 2 * 2) // Stereo audio

const frameData = {
  video: videoBuffer,
  audio: audioBuffer,
  timestamp: Date.now(),
  metadata: { width: 1920, height: 1080 }
}

// Transfer both buffers together
await api.processFrame(transfer(frameData, [videoBuffer, audioBuffer]))

// Both buffers are neutered
console.log(videoBuffer.byteLength) // 0
console.log(audioBuffer.byteLength) // 0
```

### Return Value Transfer

```typescript
// Worker can transfer data back to caller
const api = rpc.getAPI<{
  generateData(size: number): Promise<ArrayBuffer>
}>()

// Request data from worker (also transferred)
const newBuffer = await api.generateData(5 * 1024 * 1024) // 5MB
console.log("Received:", newBuffer.byteLength) // 5242880
```

## 🎯 Advanced Patterns

### Custom Transfer Handlers

For non-transferable objects containing transferable data:

```typescript
import { registerTransferHandler } from "kkrpc/browser"

// Custom class with transferable buffer
class VideoFrame {
  constructor(
    public yBuffer: ArrayBuffer,
    public uBuffer: ArrayBuffer, 
    public vBuffer: ArrayBuffer,
    public width: number,
    public height: number
  ) {}
}

// Register handler for automatic transfer
registerTransferHandler("videoFrame", {
  canHandle: (value): value is VideoFrame => value instanceof VideoFrame,
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
  deserialize: (data) => new VideoFrame(
    data.yBuffer, data.uBuffer, data.vBuffer,
    data.width, data.height
  )
})

// Now VideoFrame instances are automatically transferred
const frame = new VideoFrame(yBuf, uBuf, vBuf, 1920, 1080)
await api.processVideo(frame) // No need to call transfer() manually
```

### Bidirectional Transfer

```typescript
// Both directions can transfer data
const api = rpc.getAPI<{
  exchangeData(buffer: ArrayBuffer): Promise<ArrayBuffer>
}>()

const sendBuffer = new ArrayBuffer(1024)
const receiveBuffer = await api.exchangeData(transfer(sendBuffer, [sendBuffer]))

// sendBuffer is neutered (sent to worker)
// receiveBuffer is transferred (received from worker)
console.log(sendBuffer.byteLength) // 0
console.log(receiveBuffer.byteLength) // 1024
```

## 🔧 Worker Implementation

### Worker Side Code

```typescript
// worker.ts
import { RPCChannel, WorkerChildIO, transfer } from "kkrpc/browser"

const api = {
  // Process transferred buffer
  processBuffer(buffer: ArrayBuffer): number {
    console.log("Worker received:", buffer.byteLength)
    // Process data...
    return buffer.byteLength
  },

  // Generate and transfer new buffer
  generateData(size: number): ArrayBuffer {
    const buffer = new ArrayBuffer(size)
    // Fill with data...
    const view = new Uint8Array(buffer)
    for (let i = 0; i < size; i++) {
      view[i] = Math.floor(Math.random() * 256)
    }
    
    // Transfer back to main thread
    return transfer(buffer, [buffer])
  },

  // Exchange data (bidirectional)
  exchangeData(buffer: ArrayBuffer): ArrayBuffer {
    console.log("Worker received:", buffer.byteLength)
    
    // Create new buffer to send back
    const response = new ArrayBuffer(buffer.byteLength)
    const responseView = new Uint8Array(response)
    const originalView = new Uint8Array(buffer)
    
    // Process and return
    responseView.set(originalView.map(x => x * 2))
    return transfer(response, [response])
  }
}

const io = new WorkerChildIO()
const rpc = new RPCChannel(io, { expose: api })
```

## 🧪 Testing Transfers

### Verify Zero-Copy

```typescript
// Test to confirm transfer actually happened
const originalBuffer = new ArrayBuffer(1024)
const originalLength = originalBuffer.byteLength

await api.process(transfer(originalBuffer, [originalBuffer]))

// If transferred, buffer should be neutered
if (originalBuffer.byteLength === 0) {
  console.log("✅ Zero-copy transfer successful")
} else {
  console.log("❌ Transfer failed, data was copied")
}
```

### Performance Benchmark

```typescript
async function benchmarkTransfer(size: number) {
  // Test with transfer
  const buffer1 = new ArrayBuffer(size)
  const start1 = performance.now()
  await api.process(transfer(buffer1, [buffer1]))
  const transferTime = performance.now() - start1

  // Test without transfer (copy)
  const buffer2 = new ArrayBuffer(size)
  const start2 = performance.now()
  await api.process(buffer2) // No transfer()
  const copyTime = performance.now() - start2

  console.log(`Size: ${size/1024/1024}MB`)
  console.log(`Transfer: ${transferTime.toFixed(2)}ms`)
  console.log(`Copy: ${copyTime.toFixed(2)}ms`)
  console.log(`Speedup: ${(copyTime/transferTime).toFixed(1)}x`)
}

// Run benchmarks
await benchmarkTransfer(1 * 1024 * 1024)   // 1MB
await benchmarkTransfer(10 * 1024 * 1024)  // 10MB
await benchmarkTransfer(100 * 1024 * 1024) // 100MB
```

## 🚨 Best Practices

### When to Use Transfers

✅ **Use transfers when:**
- Transferring large binary data (>100KB)
- Using postMessage-based transports (Workers, iframes)
- Performance is critical
- You don't need the original buffer after transfer

❌ **Don't use transfers when:**
- Data is small (<1KB)
- You need to reuse the buffer
- Using text-based transports (HTTP, stdio)
- Data needs to be shared (use SharedArrayBuffer instead)

### Memory Management

```typescript
// Good: Transfer and forget
const buffer = new ArrayBuffer(size)
await api.process(transfer(buffer, [buffer]))
// buffer is automatically cleaned up when neutered

// Bad: Keep references to transferred buffers
const buffers = []
for (let i = 0; i < 10; i++) {
  const buf = new ArrayBuffer(size)
  buffers.push(buf)
  await api.process(transfer(buf, [buf]))
}
// All buffers in array are neutered (byteLength = 0)
// But array still holds references, preventing GC
```

### Error Handling

```typescript
try {
  const buffer = new ArrayBuffer(size)
  await api.process(transfer(buffer, [buffer]))
  
  // Buffer is neutered after successful transfer
  console.log(buffer.byteLength) // 0
} catch (error) {
  // On error, buffer might not be neutered
  console.log(buffer.byteLength) // Still > 0
  
  // Handle error appropriately
  console.error("Transfer failed:", error)
}
```

## 🔍 Debugging

### Common Issues

**Buffer not neutered:**
```typescript
// Wrong: Not actually transferring
await api.process(buffer) // Copied, not transferred

// Correct: Mark for transfer
await api.process(transfer(buffer, [buffer])) // Transferred
```

**Transfer array mismatch:**
```typescript
// Wrong: Missing buffer in transfer array
await api.process(transfer(data, [otherBuffer])) // Error

// Correct: Include all transferables
await api.process(transfer(data, [data.buffer, otherBuffer])) // Works
```

**Browser compatibility:**
```typescript
// Check if transfer is supported
if (typeof Worker !== 'undefined' && typeof postMessage === 'function') {
  // Transferable objects supported
  const buffer = new ArrayBuffer(size)
  await api.process(transfer(buffer, [buffer]))
} else {
  // Fallback to copying
  await api.process(buffer)
}
```

### Debug Logging

```typescript
// Enable debug mode to see transfer details
const rpc = new RPCChannel(io, { 
  expose: api,
  debug: true // Logs transfer operations
})

// Console output:
// [kkrpc] Transfer: ArrayBuffer(10485760) -> Worker
// [kkrpc] Received: ArrayBuffer(10485760) from Worker
// [kkrpc] Buffer neutered: true
```

## 📚 Related Topics

- [Web Workers Guide](./examples/webworker.md) - Using kkrpc with Web Workers
- [Property Access](./guides/property-access.md) - Remote property getters/setters
- [Error Preservation](./guides/error-preservation.md) - Complete error handling
- [HTTP Example](./examples/http.md) - Non-transferable transport example

## 🎯 Summary

Transferable objects provide significant performance benefits for large data transfers:

- **40-100x faster** for large buffers
- **Memory efficient** zero-copy transfers
- **Automatic fallback** for non-transferable transports
- **Type-safe** with full TypeScript support
- **Easy integration** with existing kkrpc code

Start using transfers today by wrapping your data with `transfer(data, [transferables])` and enjoy the performance boost!