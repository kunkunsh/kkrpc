# Transferable Objects Implementation Plan for kkrpc

## 1. Executive Summary

This document outlines a comprehensive plan to implement transferable object support in kkrpc, inspired by Comlink's approach. The implementation will enable zero-copy transfers of ArrayBuffers, MessagePorts, and other transferable objects across RPC boundaries for transports that support `postMessage`-like APIs, while maintaining backward compatibility and cross-transport flexibility.

## 2. Feature Comparison: Comlink vs kkrpc

| Feature | Comlink | kkrpc |
|---------|---------|-------|
| **Communication** | Mostly Unidirectional | Bidirectional |
| **Transports** | postMessage-based only | Multi-Transport (stdio, HTTP, WebSocket, Web Workers, etc.) |
| **API Surface** | Proxy-based (`wrap()`) | Dynamic Proxy (`getAPI()`) |
| **Property Access** | No | Full Support |
| **Serialization** | Structured Clone | JSON/superjson |
| **Transferables** | First-Class Support | **To be implemented** |
| **Extensibility** | Transfer Handlers | Adapter Pattern |

### Key Architectural Differences

| Aspect | Comlink | kkrpc |
|--------|---------|-------|
| Protocol | Binary (postMessage) | Text-based (string serialization) |
| Transports | postMessage only | Multiple protocols |
| Message Format | Structured objects | String-serialized objects |
| Transfer Support | Native | **Implementation required** |

## 3. Design Challenges and Solutions

### Challenge 1: Mixed Protocol Architecture
**Problem:** kkrpc uses string-based message serialization, but transferables require access to the raw `postMessage` API.

**Solution:**
- Extend IoInterface to expose transfer capabilities when available
- Keep string-based fallback for compatibility
- Add metadata to messages indicating transferable slots

### Challenge 2: Transport Compatibility
**Problem:** Transferable objects only work with postMessage-based APIs (Web Workers, MessageChannel, iframes). They don't work with text-based protocols (stdio, HTTP, WebSocket).

**Solution:**
- Add capability detection system to IoInterface
- Only enable transfer features for compatible transports
- Fall back to serialization for incompatible transports

### Challenge 3: Backward Compatibility
**Problem:** Existing kkrpc implementations expect string-based messages.

**Solution:**
- Make transfer support opt-in
- Negotiate capabilities during channel setup
- Gracefully degrade to serialization when peer doesn't support transfers

## 4. Proposed API Design

### 4.1 Public API (User-Facing)

```typescript
// Basic transfer API (similar to Comlink)
import { transfer, proxy } from 'kkrpc/browser'

// Transfer an ArrayBuffer
const buffer = new Uint8Array([1, 2, 3]).buffer
await api.processData(transfer(buffer, [buffer]))

// Transfer nested buffers in objects
const data = {
  buffer: buffer,
  metadata: { id: 123 }
}
await api.processData(transfer(data, [buffer]))

// Proxy a callback function
api.onProgress = proxy((progress) => {
  console.log(`Progress: ${progress}%`)
})
```

### 4.2 Transfer Handlers API

```typescript
import { transferHandlers } from 'kkrpc/browser'

// Custom transfer handler for ImageBitmap
transferHandlers.set('imageBitmap', {
  canHandle: (value) => value instanceof ImageBitmap,
  serialize: (bitmap) => {
    return [bitmap, [bitmap]] // [value, transferables]
  },
  deserialize: (bitmap) => bitmap
})

// Custom transfer handler for complex objects
transferHandlers.set('myClass', {
  canHandle: (value) => value instanceof MyClass,
  serialize: (obj) => {
    // Extract transferable parts
    const data = { 
      buffer: obj.buffer,
      metadata: obj.metadata 
    }
    return [data, [obj.buffer]]
  },
  deserialize: (data) => {
    return new MyClass(data.buffer, data.metadata)
  }
})
```

## 5. Implementation Architecture

### 5.1 Core Components

```
┌─────────────────────────────────────────────────────────┐
│                     User Code                            │
│  api.method(transfer(buffer, [buffer]))                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              Transfer Cache                              │
│  WeakMap<value, Transferable[]>                         │
│  Stores transferables associated with values            │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│           Message Processor                              │
│  - Processes args/return values                         │
│  - Extracts transferables from cache                    │
│  - Applies transfer handlers                            │
│  - Creates wire values with transfer metadata           │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│          IoInterface Adapter                             │
│  ┌────────────────┬──────────────────┐                  │
│  │ postMessage    │  String-based    │                  │
│  │ Transports     │  Transports      │                  │
│  │ (Worker, Port) │  (stdio, HTTP)   │                  │
│  └────────────────┴──────────────────┘                  │
│  - Detects capabilities                                  │
│  - Routes to appropriate send method                     │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Extended Interfaces

```typescript
// New capability interface
interface TransferCapability {
  supportsTransfer: boolean
  postMessage?(message: any, transferables: Transferable[]): void
}

// Extended IoInterface
interface IoInterface {
  name: string
  read(): Promise<Uint8Array | string | null>
  write(data: string, transfer?: Transferable[]): Promise<void>
  
  // New methods for transfer support
  capabilities?(): TransferCapability
  supportsTransfer?(): boolean
}

// Transfer handler interface (similar to Comlink)
interface TransferHandler<T, S> {
  canHandle(value: unknown): value is T
  serialize(value: T): [S, Transferable[]]
  deserialize(value: S): T
}
```

### 5.3 Wire Protocol Extensions

Current message format:
```json
{
  "id": "uuid",
  "type": "request", 
  "method": "someMethod",
  "args": [1, 2, 3],
  "version": "superjson"
}
```

New message format with transfer support:
```json
{
  "id": "uuid",
  "type": "request",
  "method": "someMethod", 
  "args": [
    1,
    { "__transferSlot": 0 },  // Placeholder for transferred value
    3
  ],
  "version": "superjson",
  "transferSlots": [
    {
      "type": "raw",
      "metadata": { "byteLength": 1024 }
    }
  ]
}
```

## 6. Implementation Phases

### Phase 1: Foundation (Week 1-2)
**Goal:** Establish core transfer infrastructure

1. **Add Transfer Cache and API**
   - Implement `transfer<T>(value: T, transferables: Transferable[]): T`
   - Create WeakMap-based transfer cache
   - Export from `kkrpc/browser` module

2. **Extend IoInterface**
   - Add `capabilities()` method
   - Add transfer parameter to `write()` method
   - Update all existing adapters with default implementations

3. **Update Message Protocol**
   - Add `transferSlots` field to Message type
   - Create transfer slot metadata structure
   - Maintain backward compatibility

**Deliverables:**
- `src/transfer.ts` - Core transfer implementation
- Updated `src/interface.ts`
- Updated `src/serialization.ts`

**Tests:**
- Unit tests for transfer cache
- Tests for capability detection
- Protocol version negotiation tests

### Phase 2: Adapter Implementation (Week 2-3)
**Goal:** Enable transfer support in postMessage-based adapters

1. **Worker Adapters**
   - Update `WorkerParentIO` to support transferables
   - Update `WorkerChildIO` to support transferables  
   - Handle transfer slot reconstruction

2. **Iframe Adapters**
   - Update `IframeParentIO`
   - Update `IframeChildIO`

3. **Chrome Extension Adapter**
   - Update `ChromePortIO`
   - Handle Chrome-specific transfer quirks

**Deliverables:**
- Updated adapter files
- Capability detection in each adapter

**Tests:**
- Worker transfer tests (ArrayBuffer, MessagePort)
- Iframe transfer tests
- Chrome extension transfer tests

### Phase 3: RPCChannel Integration (Week 3-4)
**Goal:** Integrate transfer support into the RPC call flow

1. **Outbound Transfer Processing**
   - Detect transferables in arguments
   - Extract from transfer cache
   - Build transfer slots
   - Route to appropriate send method

2. **Inbound Transfer Processing**
   - Receive messages with transferables
   - Reconstruct values from transfer slots
   - Handle nested transferred values

3. **Return Value Transfers**
   - Support transferring return values
   - Handle async return values
   - Apply transfer handlers

**Deliverables:**
- Updated `src/channel.ts`
- Transfer processing utilities

**Tests:**
- End-to-end transfer tests
- Nested transfer tests
- Bidirectional transfer tests

### Phase 4: Transfer Handlers (Week 4-5)
**Goal:** Implement extensible transfer handler system

1. **Core Transfer Handler Registry**
   - Implement handler map
   - Add built-in handlers (ArrayBuffer, MessagePort)
   - Handler priority/ordering system

2. **Built-in Transfer Handlers**
   - ArrayBuffer handler
   - TypedArray handlers
   - MessagePort handler
   - ImageBitmap handler (browser only)

3. **Custom Handler API**
   - Public API for registering handlers
   - Type-safe handler definition
   - Handler lifecycle management

**Deliverables:**
- `src/transfer-handlers.ts`
- Built-in handler implementations
- Public API exports

**Tests:**
- Transfer handler registry tests
- Built-in handler tests
- Custom handler tests
- Handler precedence tests

### Phase 5: Advanced Features (Week 5-6)
**Goal:** Add convenience features and optimizations

1. **Auto-Transfer Detection**
   - Detect ArrayBuffers in TypedArrays
   - Opt-in configuration
   - Performance optimization

2. **Proxy Marker Support**
   - Implement `proxy()` function
   - Create proxy marker symbol
   - Handle proxied callbacks

3. **Transfer Statistics**
   - Track transferred bytes
   - Monitor transfer performance
   - Debug utilities

**Deliverables:**
- Auto-transfer implementation
- Proxy marker support
- Transfer statistics API

**Tests:**
- Auto-transfer tests
- Proxy marker tests
- Performance benchmarks

## 7. Detailed Implementation Specifications

### 7.1 Transfer Cache Implementation

```typescript
// src/transfer.ts

// Transfer cache: stores transferables associated with values
const transferCache = new WeakMap<any, Transferable[]>()

/**
 * Marks a value for transfer instead of copying.
 * The value will be transferred using the Transferable protocol when sent.
 * 
 * @param value The value to transfer
 * @param transferables Array of Transferable objects to transfer
 * @returns The same value (for chaining)
 * 
 * @example
 * const buffer = new Uint8Array([1, 2, 3]).buffer
 * await api.processData(transfer(buffer, [buffer]))
 * // buffer.byteLength === 0 (transferred)
 */
export function transfer<T>(value: T, transferables: Transferable[]): T {
  transferCache.set(value, transferables)
  return value
}

/**
 * Retrieves transferables associated with a value
 * @internal
 */
export function getTransferables(value: any): Transferable[] | undefined {
  return transferCache.get(value)
}

/**
 * Checks if a value has associated transferables
 * @internal
 */
export function hasTransferables(value: any): boolean {
  return transferCache.has(value)
}

/**
 * Clears transferables for a value (cleanup after transfer)
 * @internal
 */
export function clearTransferables(value: any): void {
  transferCache.delete(value)
}
```

### 7.2 Transfer Handler System

```typescript
// src/transfer-handlers.ts

export interface TransferHandler<T = any, S = any> {
  /**
   * Determines if this handler can process the given value
   */
  canHandle(value: unknown): value is T
  
  /**
   * Serializes the value and returns transferables
   * @returns Tuple of [serialized value, transferables array]
   */
  serialize(value: T): [S, Transferable[]]
  
  /**
   * Deserializes the value back to its original form
   */
  deserialize(value: S): T
}

// Global transfer handler registry
export const transferHandlers = new Map<string, TransferHandler>()

// Built-in handlers
transferHandlers.set('arrayBuffer', {
  canHandle: (value): value is ArrayBuffer => value instanceof ArrayBuffer,
  serialize: (buffer) => [buffer, [buffer]],
  deserialize: (buffer) => buffer
})

transferHandlers.set('messagePort', {
  canHandle: (value): value is MessagePort => 
    typeof MessagePort !== 'undefined' && value instanceof MessagePort,
  serialize: (port) => [port, [port]],
  deserialize: (port) => port
})

// TypedArray handler
const typedArrayTypes = [
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array
]

transferHandlers.set('typedArray', {
  canHandle: (value): value is TypedArray => {
    return typedArrayTypes.some(Type => value instanceof Type)
  },
  serialize: (array) => {
    // Note: TypedArrays themselves aren't transferable, but their buffers are
    // We need to send metadata to reconstruct
    return [{
      type: array.constructor.name,
      buffer: array.buffer,
      byteOffset: array.byteOffset,
      length: array.length
    }, [array.buffer]]
  },
  deserialize: (data) => {
    const TypedArrayConstructor = (globalThis as any)[data.type]
    return new TypedArrayConstructor(data.buffer, data.byteOffset, data.length)
  }
})
```

### 7.3 IoInterface Adapter Updates

```typescript
// src/interface.ts

export interface IoInterface {
  name: string
  read(): Promise<Uint8Array | string | null>
  
  // Modified write method to support transferables
  write(data: string, transfer?: Transferable[]): Promise<void>
  
  // Optional methods for transfer support
  capabilities?(): TransferCapability
  supportsTransfer?(): boolean
}

export interface TransferCapability {
  supportsTransfer: boolean
  transferTypes?: ('ArrayBuffer' | 'MessagePort' | 'ImageBitmap' | 'OffscreenCanvas')[]
}

// src/adapters/worker.ts

export class WorkerParentIO implements IoInterface {
  constructor(private worker: Worker) {
    // ... existing code
  }
  
  capabilities(): TransferCapability {
    return {
      supportsTransfer: true,
      transferTypes: ['ArrayBuffer', 'MessagePort']
    }
  }
  
  supportsTransfer(): boolean {
    return true
  }
  
  async write(data: string, transfer?: Transferable[]): Promise<void> {
    if (transfer && transfer.length > 0) {
      // Use postMessage with transferables when available
      this.worker.postMessage(data, transfer)
    } else {
      // Fall back to regular postMessage
      this.worker.postMessage(data)
    }
  }
  
  // ... rest of implementation
}

export class WorkerChildIO implements IoInterface {
  capabilities(): TransferCapability {
    return {
      supportsTransfer: true,
      transferTypes: ['ArrayBuffer', 'MessagePort']
    }
  }
  
  supportsTransfer(): boolean {
    return true
  }
  
  async write(data: string, transfer?: Transferable[]): Promise<void> {
    if (transfer && transfer.length > 0) {
      self.postMessage(data, transfer)
    } else {
      self.postMessage(data)
    }
  }
  
  // ... rest of implementation
}
```

### 7.4 RPCChannel Integration

```typescript
// src/channel.ts

export class RPCChannel<LocalAPI, RemoteAPI, Io extends IoInterface = IoInterface> {
  private supportsTransfer: boolean = false
  
  constructor(private io: Io, options?: { ... }) {
    // Check if IO supports transfer
    if ('capabilities' in io && typeof io.capabilities === 'function') {
      const caps = io.capabilities()
      this.supportsTransfer = caps.supportsTransfer
    }
    // ... rest of constructor
  }
  
  public callMethod<T extends keyof RemoteAPI>(
    method: T, 
    args: any[]
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const messageId = generateUUID()
      this.pendingRequests[messageId] = { resolve, reject }

      const callbackIds: string[] = []
      let transferables: Transferable[] = []
      let transferSlots: TransferSlot[] = []
      
      // Process arguments for transfer
      const processedArgs = args.map((arg) => {
        if (typeof arg === "function") {
          // Handle callbacks (existing code)
          // ...
        }
        
        // Check for transferables if supported
        if (this.supportsTransfer) {
          const [processedValue, argTransferables, argSlots] = 
            processValueForTransfer(arg)
          
          if (argTransferables.length > 0) {
            transferables.push(...argTransferables)
            transferSlots.push(...argSlots)
            return processedValue
          }
        }
        
        return arg
      })

      const message: Message = {
        id: messageId,
        method: method as string,
        args: processedArgs,
        type: "request",
        callbackIds: callbackIds.length > 0 ? callbackIds : undefined,
        transferSlots: transferSlots.length > 0 ? transferSlots : undefined,
        supportsTransfer: this.supportsTransfer
      }
      
      // Send via appropriate method
      this.io.write(
        serializeMessage(message, this.serializationOptions), 
        transferables.length > 0 ? transferables : undefined
      )
    })
  }
  
  private handleRequest(request: Message): void {
    // Reconstruct transferred values
    let args = request.args
    if (request.transferSlots && request.transferSlots.length > 0) {
      // Extract transferred values from message
      // (These would be attached by the receiving end)
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

## 8. Testing Strategy

### 8.1 Unit Tests

```typescript
// __tests__/transfer.test.ts

describe('Transfer API', () => {
  it('should cache transferables', () => {
    const buffer = new ArrayBuffer(8)
    const value = transfer({ data: buffer }, [buffer])
    expect(getTransferables(value)).toEqual([buffer])
  })
  
  it('should handle multiple transferables', () => {
    const buffer1 = new ArrayBuffer(8)
    const buffer2 = new ArrayBuffer(16)
    const value = transfer({ buf1: buffer1, buf2: buffer2 }, [buffer1, buffer2])
    expect(getTransferables(value)).toEqual([buffer1, buffer2])
  })
})

describe('Transfer Handlers', () => {
  it('should handle ArrayBuffer', () => {
    const buffer = new ArrayBuffer(8)
    const handler = transferHandlers.get('arrayBuffer')!
    expect(handler.canHandle(buffer)).toBe(true)
    
    const [serialized, transferables] = handler.serialize(buffer)
    expect(transferables).toContain(buffer)
    expect(handler.deserialize(serialized)).toBe(buffer)
  })
  
  it('should handle TypedArray', () => {
    const array = new Uint8Array([1, 2, 3, 4])
    const handler = transferHandlers.get('typedArray')!
    expect(handler.canHandle(array)).toBe(true)
    
    const [serialized, transferables] = handler.serialize(array)
    expect(transferables).toContain(array.buffer)
    const reconstructed = handler.deserialize(serialized)
    expect(reconstructed).toBeInstanceOf(Uint8Array)
    expect(reconstructed.length).toBe(4)
  })
})
```

### 8.2 Integration Tests

```typescript
// __tests__/worker-transfer.test.ts

describe('Worker Transfer', () => {
  it('should transfer ArrayBuffer zero-copy', async () => {
    const worker = new Worker('./worker.js')
    const io = new WorkerParentIO(worker)
    const rpc = new RPCChannel(io, { expose: localAPI })
    const api = rpc.getAPI<RemoteAPI>()
    
    const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer
    const originalByteLength = buffer.byteLength
    
    const result = await api.processBuffer(transfer(buffer, [buffer]))
    
    expect(result).toBe(5) // Length
    expect(buffer.byteLength).toBe(0) // Transferred (neutered)
  })
  
  it('should handle nested transfers', async () => {
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
  
  it('should fall back when transfer not supported', async () => {
    // Test with HTTP adapter (doesn't support transfer)
    const io = new HTTPClientIO({ url: 'http://localhost:3000' })
    const rpc = new RPCChannel(io, { expose: localAPI })
    const api = rpc.getAPI<RemoteAPI>()
    
    const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer
    const originalByteLength = buffer.byteLength
    
    const result = await api.processBuffer(transfer(buffer, [buffer]))
    
    expect(result).toBe(5)
    // Should NOT be transferred (copied instead)
    expect(buffer.byteLength).toBe(originalByteLength)
  })
})
```

## 9. Performance Considerations

### 9.1 Transfer vs Serialization Benchmarks

| Data Size | Transfer Time | Serialization Time | Performance Gain |
|-----------|---------------|-------------------|------------------|
| 1KB       | <1ms          | <1ms              | Minimal          |
| 1MB       | <2ms          | 20-50ms           | 10x-25x faster   |
| 10MB      | <5ms          | 200-500ms         | 40x-100x faster  |
| 100MB     | <50ms         | 2000-5000ms       | 40x-100x faster  |

### 9.2 Memory Usage Optimization

- Zero-copy transfers significantly reduce memory usage for large binary data
- Proper cleanup of transferables prevents memory leaks
- Buffer reuse patterns can be implemented for repeated transfers

## 10. Migration Guide

### For Users Migrating from Comlink

```typescript
// Comlink
import * as Comlink from 'comlink'

const worker = new Worker('worker.js')
const api = Comlink.wrap(worker)
await api.method(Comlink.transfer(buffer, [buffer]))

// kkrpc equivalent
import { RPCChannel, WorkerParentIO, transfer } from 'kkrpc/browser'

const worker = new Worker('worker.js')
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel(io)
const api = rpc.getAPI()
await api.method(transfer(buffer, [buffer]))
```

### For Existing kkrpc Users

```typescript
// Before (no transfer support)
const buffer = new Uint8Array([1, 2, 3]).buffer
await api.processBuffer(buffer) // Serialized (copied)

// After (with transfer support)
import { transfer } from 'kkrpc/browser'
const buffer = new Uint8Array([1, 2, 3]).buffer
await api.processBuffer(transfer(buffer, [buffer])) // Transferred (zero-copy)
```

## 11. Compatibility Matrix

| Transport | Transfer Support | Fallback | Notes |
|-----------|------------------|----------|-------|
| Web Worker | ✅ Full | N/A | Native postMessage support |
| Shared Worker | ✅ Full | N/A | Native postMessage support |
| iframe | ✅ Full | N/A | Native postMessage support |
| MessageChannel | ✅ Full | N/A | Native postMessage support |
| Chrome Extension | ✅ Full | N/A | Chrome runtime.Port support |
| stdio | ❌ No | Serialize | Text-based protocol |
| HTTP | ❌ No | Serialize | Text-based protocol |
| WebSocket | ⚠️ Partial | Serialize | Binary frames possible (future) |
| Socket.IO | ⚠️ Partial | Serialize | Binary frames possible (future) |
| Tauri Shell | ❌ No | Serialize | Text-based protocol |

## 12. Risk Analysis

### High Risks
1. **Breaking Changes:** Modifying core message protocol
   - **Mitigation:** Version negotiation, backward compatibility layer
   
2. **Performance Regression:** Overhead in non-transfer cases
   - **Mitigation:** Performance benchmarks, lazy evaluation

### Medium Risks
1. **Browser Compatibility:** Different transfer behavior
   - **Mitigation:** Extensive cross-browser testing
   
2. **Memory Leaks:** Transfer cache not cleaned up
   - **Mitigation:** WeakMap usage, explicit cleanup APIs

### Low Risks
1. **API Confusion:** Users forgetting to call transfer()
   - **Mitigation:** Clear documentation, TypeScript hints

## 13. Success Metrics

### Performance Metrics
- ✅ Transfer 10MB buffer in <5ms (vs >100ms for serialization)
- ✅ Zero-copy confirmed (buffer.byteLength === 0 after transfer)
- ✅ <1% overhead for non-transfer messages

### Compatibility Metrics
- ✅ All existing tests pass
- ✅ All transports maintain backward compatibility
- ✅ Graceful degradation for incompatible transports

### Usability Metrics
- ✅ API similar to Comlink (easy migration)
- ✅ TypeScript types maintain safety
- ✅ Clear error messages

## 14. Timeline Summary

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| Phase 1 | 2 weeks | Foundation, APIs, Protocol |
| Phase 2 | 1 week | Adapter Updates |
| Phase 3 | 1 week | RPCChannel Integration |
| Phase 4 | 1 week | Transfer Handlers |
| Phase 5 | 1 week | Advanced Features |
| **Total** | **6 weeks** | **Full Implementation** |

## 15. Conclusion

This implementation plan provides a comprehensive roadmap for adding transferable object support to kkrpc while maintaining its unique multi-transport architecture. The phased approach ensures:

1. **Backward Compatibility:** Existing code continues to work
2. **Progressive Enhancement:** Transfer support added where beneficial
3. **Clear Migration Path:** Users can adopt incrementally
4. **Robust Testing:** Each phase has clear test coverage
5. **Future-Proof:** Design allows for future enhancements

The implementation draws inspiration from Comlink's elegant API while adapting it to kkrpc's more diverse transport ecosystem, creating a best-of-both-worlds solution that enables high-performance zero-copy transfers for postMessage-based transports while maintaining support for all existing transport types.