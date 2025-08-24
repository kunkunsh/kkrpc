# kkrpc Missing Features Implementation Plan

## Analysis of Current State

### ✅ Already Supported
- **Deep Property Access**: kkrpc DOES support dot notation through `createNestedProxy()` and method path parsing in `handleRequest()`
- **Bidirectional RPC**: Full support for both sides calling each other's APIs
- **Callback Support**: Function arguments are properly handled with callback serialization
- **Multiple Transport Layers**: stdio, HTTP, WebSocket, Web Worker, iframe, Chrome Extension, Tauri
- **Enhanced Serialization**: superjson support for complex data types (Date, Map, Set, BigInt, Uint8Array)

## Missing Features Analysis

### 1. Property Getters and Setters 🟢 EASY
**Feasibility**: ✅ Fully achievable with current JSON-RPC design
**Implementation**: Add new message types "GET" and "SET" to complement existing "request", "response", "callback"

### 2. Class Constructor Support 🟡 MEDIUM
**Feasibility**: ✅ Achievable with current design
**Implementation**: Add "CONSTRUCT" message type and modify proxy to handle `new` operator

### 3. Enhanced Error Preservation 🟢 EASY
**Feasibility**: ✅ Fully achievable
**Implementation**: Extend serialization to preserve Error objects with stack traces and custom properties

### 4. Transferable Objects Support 🔴 COMPLEX
**Feasibility**: ⚠️ **Limited by transport layer**
- **Browser (postMessage)**: ✅ Fully supported (ArrayBuffer, MessagePort, etc.)
- **HTTP/WebSocket**: ❌ **Impossible** - HTTP is text-based, cannot transfer object ownership
- **stdio**: ❌ **Impossible** - stdin/stdout are text streams
- **Recommendation**: Implement for postMessage-based transports only (Web Worker, iframe)

### 5. Custom Transfer Handlers 🟡 MEDIUM
**Feasibility**: ✅ Achievable
**Implementation**: Plugin system for custom serialization handlers, similar to comlink's transferHandlers

### 6. Proxy Lifecycle Management 🟡 MEDIUM
**Feasibility**: ✅ Achievable
**Implementation**: Add special methods and FinalizationRegistry support for automatic cleanup

### 7. Origin Validation 🟢 EASY
**Feasibility**: ✅ Achievable for web-based transports
**Implementation**: Add origin checking to iframe and web worker adapters

### 8. SharedWorker Support 🟢 EASY
**Feasibility**: ✅ Achievable
**Implementation**: Create dedicated SharedWorker adapter using port-based communication

## Implementation Progress

### ✅ COMPLETED - Phase 1: Property Getters and Setters
**Status**: Fully implemented and tested

**What was implemented**:
1. **Extended Message Interface**: Added new message types "get", "set", "construct" to support property operations
2. **New RPC Methods**: 
   - `getProperty(path)` - Gets remote property values
   - `setProperty(path, value)` - Sets remote property values
   - `callConstructor(constructor, args)` - Calls remote constructors
3. **Enhanced Message Handlers**:
   - `handleGet()` - Processes property get requests
   - `handleSet()` - Processes property set requests  
   - `handleConstruct()` - Processes constructor calls
4. **Enhanced Proxy System**: Updated `createNestedProxy()` with:
   - Property getter support via proxy `get` trap
   - Property setter support via proxy `set` trap
   - Constructor support via proxy `construct` trap
   - Thenable support for `await obj.prop` syntax

**Usage Examples**:
```typescript
const api = rpc.getAPI()

// Property getters
const value = await api.counter        // Gets remote property
const nested = await api.obj.nested.prop  // Deep property access

// Property setters  
api.counter = 42                       // Sets remote property
api.obj.nested.prop = "hello"          // Deep property setting

// Constructor calls
const instance = await new api.MyClass("arg1", "arg2")
```

**Files Modified**:
- `packages/kkrpc/src/serialization.ts` - Extended Message interface
- `packages/kkrpc/src/channel.ts` - Added new methods and handlers
- Test files created for validation

### ✅ COMPLETED - Enhanced Error Preservation
**Status**: Fully implemented and tested

**What was implemented**:
1. **Enhanced Error Interface**: Added `EnhancedError` interface to preserve error details
2. **Error Serialization**: 
   - `serializeError()` - Converts Error objects to transmittable format
   - `deserializeError()` - Reconstructs Error objects from transmitted data
3. **Enhanced Error Handling**:
   - Updated `handleResponse()` to deserialize enhanced errors
   - Updated `sendError()` to accept and serialize Error objects
   - Updated all handler methods to pass Error objects instead of strings
4. **Preserved Error Information**:
   - Error name and type
   - Full stack traces
   - Error cause (modern Error API)
   - Custom properties on error objects

**Features**:
```typescript
// Before: Only error message preserved
try { await api.failingMethod() } 
catch (err) { 
  console.log(err.message) // "Something went wrong"
  console.log(err.stack)   // undefined
}

// After: Full error information preserved
try { await api.failingMethod() }
catch (err) {
  console.log(err.name)      // "CustomError" 
  console.log(err.message)   // "Something went wrong"
  console.log(err.stack)     // Full stack trace
  console.log(err.code)      // Custom properties preserved
  console.log(err.cause)     // Error cause preserved
}
```

### 🔄 NEXT: Enhanced Error Preservation
**Priority**: High - Improves debugging experience
**Complexity**: Easy

## Implementation Priority

### Phase 1: Easy Wins (Week 1)
1. **Property Getters/Setters** - Core RPC functionality
2. **Enhanced Error Preservation** - Better debugging experience
3. **Origin Validation** - Security improvement

### Phase 2: Medium Complexity (Week 2-3)
4. **Class Constructor Support** - Enhanced API compatibility
5. **Custom Transfer Handlers** - Extensibility
6. **SharedWorker Support** - Complete web worker coverage

### Phase 3: Advanced Features (Week 4)
7. **Proxy Lifecycle Management** - Memory management
8. **Transferable Objects** - Performance optimization (postMessage only)

## Technical Design Decisions

### Message Type Extensions
```typescript
type MessageType = "request" | "response" | "callback" | "get" | "set" | "construct"
```

### Error Object Enhancement
```typescript
interface EnhancedError {
  name: string
  message: string
  stack?: string
  [key: string]: any // Custom properties
}
```

### Transfer Handler System
```typescript
interface TransferHandler<T, S> {
  canHandle(value: unknown): value is T
  serialize(value: T): [S, Transferable[]]
  deserialize(value: S): T
}
```

## Q&A

### Q: Is transferable objects browser-only?
**A**: Transferable objects are indeed a browser/Web API concept. They work with:
- `postMessage()` between windows, workers, and iframes
- `MessageChannel` and `MessagePort`

They **CANNOT** work with:
- HTTP requests (text-based protocol)
- WebSockets (text/binary frames, but no ownership transfer)
- stdio pipes (text streams)

### Q: Any impossible features with current JSON-RPC design?
**A**: The JSON-RPC design is actually very flexible. The only limitations are:
1. **True transferable objects** - Only possible with postMessage-based transports
2. **Synchronous calls** - JSON-RPC is inherently async (but this is generally better)
3. **Binary data efficiency** - JSON encoding adds overhead (but superjson helps)

### Q: Performance implications?
**A**: 
- **Property access** will require network round-trips (unlike local objects)
- **Constructor calls** will be async (unlike local constructors)
- **Getters/setters** should be cached where possible to reduce RPC calls

## Next Steps

1. Start with property getters/setters implementation
2. Add comprehensive tests for each feature
3. Update TypeScript types to reflect new capabilities
4. Document new APIs and migration guide from comlink