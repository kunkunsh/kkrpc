# Transferable Objects Implementation Plan for kkrpc

## Executive Summary

This document outlines a comprehensive plan to implement transferable object support in kkrpc, inspired by Comlink's approach. The implementation will enable zero-copy transfers of ArrayBuffers, MessagePorts, and other transferable objects across RPC boundaries for transports that support `postMessage`-like APIs.

---

## 1. Feature Comparison: Comlink vs kkrpc

### Comlink Features
- ✅ `Comlink.transfer(value, transferables)` - Mark values for transfer
- ✅ `Comlink.proxy(value)` - Create proxy references
- ✅ Transfer handlers - Custom serialization for specific types
- ✅ Automatic transfer detection via WeakMap cache
- ✅ Works with postMessage-based protocols only
- ✅ Direct binary transfer (no serialization overhead)

### kkrpc Current Features
- ✅ Multiple transport protocols (stdio, HTTP, WebSocket, postMessage)
- ✅ Bidirectional communication
- ✅ Property access and setters
- ✅ Error preservation
- ✅ Callback support
- ✅ Nested method calls
- ✅ JSON/superjson serialization
- ❌ **No transferable object support**

### Key Architectural Differences

| Aspect | Comlink | kkrpc |
|--------|---------|-------|
| Protocol | Binary (postMessage) | Text-based (string serialization) |
| Transports | postMessage only | stdio, HTTP, WS, postMessage, etc. |
| Serialization | Structured cloning | JSON/superjson |
| Transfer Support | Native | **Not yet implemented** |

---

## 2. Design Challenges

### Challenge 1: Transport Compatibility
**Problem:** Transferable objects only work with postMessage-based APIs (Web Workers, MessageChannel, iframes). They don't work with text-based protocols (stdio, HTTP, WebSocket).

**Solution:** 
- Add a capability detection system to IoInterface
- Only enable transfer features for compatible transports
- Fall back to serialization for incompatible transports

### Challenge 2: Mixed Protocol Architecture
**Problem:** kkrpc uses string-based message serialization, but transferables require access to the raw `postMessage` API.

**Solution:**
- Extend IoInterface to expose a `postMessage` method when available
- Keep string-based fallback for compatibility
- Add metadata to messages indicating transferable slots

### Challenge 3: Backward Compatibility
**Problem:** Existing kkrpc implementations expect string-based messages.

**Solution:**
- Make transfer support opt-in
- Negotiate capabilities during channel setup
- Gracefully degrade to serialization when peer doesn't support transfers

---

## 3. Proposed API Design

### 3.1 Public API (User-Facing)

```typescript
// Basic transfer API (similar to Comlink)
import { transfer, proxy } from 'kkrpc/browser'

// Transfer an ArrayBuffer
const buffer = new Uint8Array([1, 2, 3]).buffer
await api.processData(transfer(buffer, [buffer]))

// Transfer nested buffers
await api.processData(transfer({ data: { buffer } }, [buffer]))

// Proxy a callback function
api.onProgress = proxy((progress) => {
  console.log(`Progress: ${progress}%`)
})
```

### 3.2 Transfer Handlers API

```typescript
import { transferHandlers } from 'kkrpc/browser'

// Custom transfer handler for ImageBitmap
transferHandlers.set('imageBitmap', {
  canHandle: (value) => value instanceof ImageBitmap,
  serialize: (bitmap) => {
    return [bitmap, [bitmap]] // Value and transferables
  },
  deserialize: (bitmap) => bitmap
})

// Custom transfer handler for custom classes
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

### 3.3 Automatic Transfer Detection

```typescript
// Option 1: Auto-detect transferables in Uint8Array
const data = new Uint8Array([1, 2, 3, 4, 5])
// User can opt-in to auto-transfer
const rpc = new RPCChannel(io, {
  expose: api,
  autoTransfer: true // Auto-detect ArrayBuffers in Uint8Array
})

// Option 2: Manual control (default)
await api.processData(transfer(data, [data.buffer]))
```

---

## 4. Implementation Architecture

### 4.1 Core Components

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

### 4.2 Extended Interfaces

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
  write(data: string): Promise<void>
  
  // New optional methods for transfer support
  capabilities?(): TransferCapability
  postMessageRaw?(message: any, transferables?: Transferable[]): Promise<void>
}

// Transfer handler interface (similar to Comlink)
interface TransferHandler<T, S> {
  canHandle(value: unknown): value is T
  serialize(value: T): [S, Transferable[]]
  deserialize(value: S): T
}
```

### 4.3 Wire Protocol Extensions

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

For postMessage transports, the actual message:
```javascript
// Message object
const msg = { /* JSON above */ }

// Transferables array (passed separately to postMessage)
const transferables = [buffer]

// Send via postMessage
port.postMessage(msg, transferables)
```

---

## 5. Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goal:** Establish core transfer infrastructure

1. **Add Transfer Cache and API**
   - Implement `transfer<T>(value: T, transferables: Transferable[]): T`
   - Create WeakMap-based transfer cache
   - Export from `kkrpc/browser` module

2. **Extend IoInterface**
   - Add `capabilities()` method
   - Add `postMessageRaw()` method
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
   - Update `WorkerParentIO` to support `postMessageRaw()`
   - Update `WorkerChildIO` to support `postMessageRaw()`
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

### Phase 6: Documentation & Polish (Week 6-7)

**Goal:** Complete documentation and ensure production-readiness

1. **Documentation**
   - API reference documentation
   - Usage examples
   - Migration guide
   - Performance best practices

2. **Examples**
   - Worker transfer example
   - Iframe transfer example
   - Chrome extension transfer example
   - Custom transfer handler example

3. **Polish**
   - Error messages
   - Type definitions
   - JSDoc comments
   - README updates

**Deliverables:**
- Complete documentation
- Working examples
- Updated README

---

## 6. Detailed Implementation Specifications

### 6.1 Transfer Cache Implementation

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

### 6.2 Proxy Marker Implementation

```typescript
// src/transfer.ts

export const proxyMarker = Symbol('kkrpc.proxy')

export interface ProxyMarked {
  [proxyMarker]: true
}

/**
 * Marks a value to be proxied instead of copied or transferred.
 * Useful for callbacks and objects that need to maintain reference identity.
 * 
 * @param value The value to proxy
 * @returns The value with proxy marker
 * 
 * @example
 * api.onProgress = proxy((progress) => {
 *   console.log(`Progress: ${progress}%`)
 * })
 */
export function proxy<T extends {}>(value: T): T & ProxyMarked {
  return Object.assign(value, { [proxyMarker]: true }) as T & ProxyMarked
}

/**
 * Checks if a value is marked for proxying
 * @internal
 */
export function isProxyMarked(value: any): value is ProxyMarked {
  return typeof value === 'object' && value !== null && proxyMarker in value
}
```

### 6.3 Transfer Handler System

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

### 6.4 Extended Wire Protocol

```typescript
// src/serialization.ts

export interface TransferSlot {
  type: 'raw' | 'handler'
  handlerName?: string
  metadata?: any
}

export interface Message<T = any> {
  id: string
  method: string
  args: T
  type: "request" | "response" | "callback" | "get" | "set" | "construct"
  callbackIds?: string[]
  version?: "json" | "superjson"
  path?: string[]
  value?: any
  
  // New fields for transfer support
  transferSlots?: TransferSlot[]
  supportsTransfer?: boolean // Capability flag
}

export const TRANSFER_SLOT_PREFIX = '__kkrpc_transfer_slot_'

/**
 * Processes a value and extracts transferables
 * @returns Tuple of [processed value, transferables array, transfer slots]
 */
export function processValueForTransfer(
  value: any
): [any, Transferable[], TransferSlot[]] {
  const transferables: Transferable[] = []
  const transferSlots: TransferSlot[] = []
  
  // Check transfer cache first
  const cachedTransferables = getTransferables(value)
  if (cachedTransferables && cachedTransferables.length > 0) {
    transferables.push(...cachedTransferables)
    transferSlots.push({
      type: 'raw',
      metadata: { original: true }
    })
    // Replace value with slot reference
    return [`${TRANSFER_SLOT_PREFIX}0`, transferables, transferSlots]
  }
  
  // Check transfer handlers
  for (const [name, handler] of transferHandlers) {
    if (handler.canHandle(value)) {
      const [serialized, handlerTransferables] = handler.serialize(value)
      const slotIndex = transferSlots.length
      transferables.push(...handlerTransferables)
      transferSlots.push({
        type: 'handler',
        handlerName: name,
        metadata: serialized
      })
      return [`${TRANSFER_SLOT_PREFIX}${slotIndex}`, transferables, transferSlots]
    }
  }
  
  // Process nested objects/arrays recursively
  if (Array.isArray(value)) {
    const processed = value.map(v => processValueForTransfer(v))
    const allTransferables = processed.flatMap(p => p[1])
    const allSlots = processed.flatMap(p => p[2])
    return [processed.map(p => p[0]), allTransferables, allSlots]
  }
  
  if (value && typeof value === 'object') {
    const processed: any = {}
    for (const [key, val] of Object.entries(value)) {
      const [processedVal, valTransferables, valSlots] = processValueForTransfer(val)
      processed[key] = processedVal
      transferables.push(...valTransferables)
      transferSlots.push(...valSlots)
    }
    return [processed, transferables, transferSlots]
  }
  
  // Return as-is
  return [value, [], []]
}

/**
 * Reconstructs a value from transfer slots
 */
export function reconstructValueFromTransfer(
  value: any,
  transferSlots: TransferSlot[],
  transferredValues: any[]
): any {
  // Check if this is a transfer slot reference
  if (typeof value === 'string' && value.startsWith(TRANSFER_SLOT_PREFIX)) {
    const slotIndex = parseInt(value.slice(TRANSFER_SLOT_PREFIX.length))
    const slot = transferSlots[slotIndex]
    const transferredValue = transferredValues[slotIndex]
    
    if (slot.type === 'raw') {
      return transferredValue
    } else if (slot.type === 'handler' && slot.handlerName) {
      const handler = transferHandlers.get(slot.handlerName)
      if (handler) {
        return handler.deserialize(transferredValue)
      }
    }
    throw new Error(`Invalid transfer slot: ${slotIndex}`)
  }
  
  // Process nested recursively
  if (Array.isArray(value)) {
    return value.map(v => reconstructValueFromTransfer(v, transferSlots, transferredValues))
  }
  
  if (value && typeof value === 'object') {
    const reconstructed: any = {}
    for (const [key, val] of Object.entries(value)) {
      reconstructed[key] = reconstructValueFromTransfer(val, transferSlots, transferredValues)
    }
    return reconstructed
  }
  
  return value
}
```

### 6.5 IoInterface Adapter Updates

```typescript
// src/adapters/worker.ts

export class WorkerParentIO implements IoInterface, TransferCapability {
  constructor(private worker: Worker) {
    // ... existing code
  }
  
  capabilities(): TransferCapability {
    return {
      supportsTransfer: true,
      postMessage: (message, transferables) => {
        this.worker.postMessage(message, transferables)
      }
    }
  }
  
  async postMessageRaw(message: any, transferables: Transferable[] = []): Promise<void> {
    // Send raw message with transferables
    this.worker.postMessage(message, transferables)
  }
  
  // ... rest of implementation
}

export class WorkerChildIO implements IoInterface, TransferCapability {
  capabilities(): TransferCapability {
    return {
      supportsTransfer: true,
      postMessage: (message, transferables) => {
        self.postMessage(message, transferables)
      }
    }
  }
  
  async postMessageRaw(message: any, transferables: Transferable[] = []): Promise<void> {
    self.postMessage(message, transferables)
  }
  
  // ... rest of implementation
}
```

### 6.6 RPCChannel Integration

```typescript
// src/channel.ts

export class RPCChannel<...> {
  // ... existing code
  
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
      if (this.supportsTransfer && 
          transferables.length > 0 && 
          'postMessageRaw' in this.io) {
        // Use postMessage with transferables
        (this.io as any).postMessageRaw(
          serializeMessage(message, this.serializationOptions),
          transferables
        )
      } else {
        // Fall back to string serialization
        this.io.write(serializeMessage(message, this.serializationOptions))
      }
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

---

## 7. Testing Strategy

### 7.1 Unit Tests

```typescript
// __tests__/transfer.test.ts

describe('Transfer API', () => {
  it('should cache transferables', () => {
    const buffer = new ArrayBuffer(8)
    const value = transfer({ data: buffer }, [buffer])
    expect(getTransferables(value)).toEqual([buffer])
  })
  
  it('should create proxy marker', () => {
    const callback = () => {}
    const proxied = proxy(callback)
    expect(isProxyMarked(proxied)).toBe(true)
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
  
  it('should handle custom types', () => {
    transferHandlers.set('test', {
      canHandle: (v) => v instanceof TestClass,
      serialize: (v) => [{ data: v.data }, [v.buffer]],
      deserialize: (v) => new TestClass(v.data)
    })
    
    const obj = new TestClass(new ArrayBuffer(8))
    const handler = transferHandlers.get('test')!
    const [serialized, transferables] = handler.serialize(obj)
    expect(transferables.length).toBe(1)
  })
})
```

### 7.2 Integration Tests

```typescript
// __tests__/worker-transfer.test.ts

describe('Worker Transfer', () => {
  it('should transfer ArrayBuffer', async () => {
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

### 7.3 Performance Tests

```typescript
// __tests__/transfer-performance.test.ts

describe('Transfer Performance', () => {
  it('should be faster than serialization for large buffers', async () => {
    const largeBuffer = new ArrayBuffer(10 * 1024 * 1024) // 10MB
    
    // Measure transfer time
    const transferStart = performance.now()
    await api.processBuffer(transfer(largeBuffer, [largeBuffer]))
    const transferTime = performance.now() - transferStart
    
    // Measure serialization time (without transfer)
    const copyBuffer = new ArrayBuffer(10 * 1024 * 1024)
    const copyStart = performance.now()
    await api.processBuffer(copyBuffer)
    const copyTime = performance.now() - copyStart
    
    console.log(`Transfer: ${transferTime}ms, Copy: ${copyTime}ms`)
    expect(transferTime).toBeLessThan(copyTime)
  })
})
```

---

## 8. Migration Guide

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

---

## 9. Compatibility Matrix

| Transport | Transfer Support | Fallback | Notes |
|-----------|-----------------|----------|-------|
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

---

## 10. Future Enhancements

### 10.1 WebSocket Binary Frames
- Add binary frame support for WebSocket adapter
- Enable transfers over WebSocket connections
- Implement frame splitting for large buffers

### 10.2 Streaming Transfers
- Support streaming large buffers in chunks
- Progress callbacks
- Cancellation support

### 10.3 Shared Memory Support
- SharedArrayBuffer integration
- Atomic operations across threads
- Memory pool management

### 10.4 Compression
- Compress serialized data before transfer
- LZ4/Snappy integration
- Adaptive compression based on size

---

## 11. Risk Analysis

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

---

## 12. Success Metrics

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

---

## 13. Timeline Summary

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| Phase 1 | 2 weeks | Foundation, APIs, Protocol |
| Phase 2 | 1 week | Adapter Updates |
| Phase 3 | 1 week | RPCChannel Integration |
| Phase 4 | 1 week | Transfer Handlers |
| Phase 5 | 1 week | Advanced Features |
| Phase 6 | 1 week | Documentation |
| **Total** | **7 weeks** | **Full Implementation** |

---

## 14. Open Questions

1. **Auto-transfer default behavior?**
   - Should auto-transfer be opt-in or opt-out?
   - What heuristics should trigger auto-transfer?

2. **TypeScript types for transferred values?**
   - How to type-check that buffers are neutered?
   - Should we have `Transferred<T>` type?

3. **WebSocket binary mode?**
   - Should we add binary frame support immediately?
   - What's the priority vs other features?

4. **Error handling for failed transfers?**
   - What happens if transfer fails?
   - Should we auto-fallback to serialization?

---

## 15. Conclusion

This implementation plan provides a comprehensive roadmap for adding transferable object support to kkrpc while maintaining its unique multi-transport architecture. The phased approach ensures:

1. **Backward Compatibility:** Existing code continues to work
2. **Progressive Enhancement:** Transfer support added where beneficial
3. **Clear Migration Path:** Users can adopt incrementally
4. **Robust Testing:** Each phase has clear test coverage
5. **Future-Proof:** Design allows for future enhancements

The implementation draws inspiration from Comlink's elegant API while adapting it to kkrpc's more diverse transport ecosystem, creating a best-of-both-worlds solution.

---

**Document Version:** 1.0  
**Author:** Claude (Anthropic)  
**Date:** October 25, 2025  
**Status:** Proposal - Ready for Review

