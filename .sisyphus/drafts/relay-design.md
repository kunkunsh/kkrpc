# kkrpc Relay - Transparent Protocol Relay

## Concept

Since all kkrpc adapters speak the same protocol (JSON messages over read/write), we can create a **transparent relay** that pipes messages between two IoInterfaces without knowing anything about the API.

## Architecture

```
Client ──Adapter A───► Relay ──Adapter B───► Server
      (IPC/stdio/WS)      (just pipes)    (stdio/worker/WS)
```

**Key insight**: The relay doesn't parse JSON or know method names. It just forwards bytes.

## Usage

### 1. Simple Relay (Pipe Mode)

```typescript
import { createRelay, ElectronIpcMainIO, NodeIo } from "kkrpc"

// Relay between Electron IPC and stdio worker
const relay = createRelay({
	sideA: new ElectronIpcMainIO(ipcMain, webContents), // From renderer
	sideB: new NodeIo(worker.stdout, worker.stdin) // To worker
})

// That's it! Messages flow transparently
// No API definitions needed on relay
```

### 2. Multi-Route Relay (Router Mode)

```typescript
import { createRouter } from "kkrpc"

const router = createRouter({
	// Route by path prefix
	routes: {
		"math.": new NodeIo(mathWorker.stdout, mathWorker.stdin),
		"db.": new NodeIo(dbWorker.stdout, dbWorker.stdin),
		"fs.": new NodeIo(fsWorker.stdout, fsWorker.stdin)
	}
})

// "math.add" → math worker
// "db.query" → db worker
// "fs.read" → fs worker
```

### 3. Bidirectional Relay

```typescript
// Both sides can call each other through relay
const relay = createBidirectionalRelay({
	sideA: rendererIO,
	sideB: workerIO
})
```

## Current vs Relay Approach

### Current (Manual Delegation)

```typescript
// main.ts needs to know ALL methods
const mainAPI = {
	worker: {
		calculateFactorial: (n) => workerAPI.calculateFactorial(n),
		calculateFibonacci: (n) => workerAPI.calculateFibonacci(n)
		// ... 20 more methods
	}
}
```

### Relay Approach

```typescript
// Just pipe the adapters
const relay = createRelay({
	sideA: rendererIO, // Receives: {"method":"worker.calculateFactorial",...}
	sideB: workerIO // Forwards as-is
})
// No method signatures needed!
```

## Benefits

1. **Zero API Knowledge**: Relay doesn't know method names or signatures
2. **Universal**: Works with any adapter combination
3. **Zero Overhead**: No serialization/deserialization at relay
4. **Type Safe**: Types are enforced at endpoints, not relay
5. **Composable**: Chain multiple relays: A → Relay → B → Relay → C

## Implementation

The relay is essentially:

```typescript
async function relay(sideA: IoInterface, sideB: IoInterface) {
	// A → B
	sideA.read().then((msg) => sideB.write(msg))

	// B → A
	sideB.read().then((msg) => sideA.write(msg))
}
```

But with proper error handling, backpressure, and cleanup.

## Use Cases

1. **Electron**: Renderer ↔ Main ↔ Worker (transparent)
2. **Load Balancing**: Multiple clients → Relay → Pool of workers
3. **Protocol Bridge**: HTTP client → Relay → stdio worker
4. **Chaining**: Browser → Relay A → Server → Relay B → Database

## Next Steps

1. Implement `createRelay()` in kkrpc core
2. Add `createRouter()` for multi-target routing
3. Create examples showing relay vs delegation patterns
4. Document when to use each approach

## Question

Should this be a separate package (`kkrpc-relay`) or part of core kkrpc?
