# Transferable Objects – Browser Worker Demo

This SvelteKit app demonstrates how `kkrpc`'s transferable object support enables zero-copy
communication between the main thread and a browser worker. The UI lets you generate buffers,
send them to the worker, request buffers back, and observe the byte lengths reported on both
sides to verify that ownership actually moves across the worker boundary.

## 🚀 What are Transferable Objects?

Transferable objects are a browser feature that allows **zero-copy** transfer of data between different contexts. Instead of copying large amounts of data (which can be slow and memory-intensive), ownership of the data is transferred directly.

**Key Benefits:**

- **40-100x faster** for large data transfers (>1MB)
- **Memory efficient** - no duplicate data in memory
- **Zero-copy** - ownership moves without copying

**What gets transferred?**

- `ArrayBuffer` - Binary data buffers
- `MessagePort` - Communication channels
- `ImageBitmap` - Decoded image data
- `OffscreenCanvas` - Off-screen canvas rendering
- And more... [See MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)

## Manual Testing

```sh
pnpm install
pnpm dev -- --open
```

### What To Verify

- The browser opens the transferable object demo UI.
- Choose a buffer size and click the control that sends a buffer to the worker.
- The log should show that the original buffer's `byteLength` drops to `0` after transfer.
- Request a buffer from the worker and verify the received byte length matches the selected size.
- Larger buffers should transfer quickly and preserve checksum or integrity indicators shown in the UI.

Two helpful scripts live in `package.json` as well:

- `pnpm test` – runs the Vitest component suite (with the worker mocked)
- `pnpm test:e2e` – launches Playwright and validates the end-to-end transfer flow in the browser

### Troubleshooting

- If Playwright browsers are missing, install them with `pnpm exec playwright install` from this example directory.
- If the worker fails to load, check browser DevTools for a worker script 404 or Vite dev server error.

## 🏗️ How it works

### Architecture

```
┌─────────────────┐    postMessage    ┌─────────────────┐
│   Main Thread  │ ──────────────────> │   Web Worker    │
│                │                   │                │
│  - UI Layer    │ <───────────────── │  - Processing  │
│  - kkrpc API   │    transfer()     │  - kkrpc API   │
└─────────────────┘                   └─────────────────┘
```

### Key Components

- **`src/lib/worker/transfer-worker.ts`** - Worker implementation

  - Initialises an `RPCChannel` inside a dedicated worker
  - Exposes two RPC methods: `processBuffer` (main → worker) and `provideBuffer` (worker → main)
  - When sending data back, marks payload with `transfer(...)` for zero-copy transfer

- **`src/routes/+page.svelte`** - Main UI component
  - Creates the worker channel on mount
  - Provides interactive buffer size controls
  - Displays real-time transfer logs and statistics
  - Shows byte-length before/after to verify transfer vs copy

### Transfer Flow

1. **Main → Worker Transfer:**

   ```typescript
   // Create buffer
   const buffer = new ArrayBuffer(size);
   console.log(buffer.byteLength); // e.g., 10485760

   // Transfer to worker (zero-copy)
   await api.processBuffer(transfer(buffer, [buffer]));
   console.log(buffer.byteLength); // 0 (neutered!)
   ```

2. **Worker → Main Transfer:**

   ```typescript
   // Worker generates data and transfers back
   const newBuffer = new ArrayBuffer(size);
   return transfer(newBuffer, [newBuffer]);

   // Main receives transferred buffer
   const received = await api.provideBuffer();
   console.log(received.byteLength); // Full size
   ```

## 🎮 Using the Demo

1. **Adjust Buffer Size:** Use the slider to create different sized buffers (1KB - 100MB)
2. **Transfer to Worker:** Click "Send to Worker" to transfer buffer from main thread
3. **Request from Worker:** Click "Request from Worker" to get buffer from worker
4. **Observe Results:** Watch the log to see:
   - Buffer sizes before/after transfer
   - Transfer time measurements
   - Memory efficiency indicators

## 🔍 What to Look For

When testing transfers, watch for these key indicators:

- **`byteLength` drops to `0`** - Confirms zero-copy transfer
- **Fast transfer times** - Should be significantly faster than copying
- **No memory duplication** - Total memory usage stays constant
- **Checksum preservation** - Data integrity maintained during transfer

## 🧪 Testing

### Unit Tests

```sh
pnpm test
```

Runs component tests with mocked worker to verify UI logic.

### E2E Tests

```sh
pnpm test:e2e
```

Launches Playwright to test real browser behavior:

- ArrayBuffer transfer verification
- Performance benchmarking
- UI interaction validation

## 📊 Performance Comparison

Based on testing in this demo:

| Buffer Size | Copy Time | Transfer Time | Speedup |
| ----------- | --------- | ------------- | ------- |
| 1MB         | 15ms      | 2ms           | 7.5x    |
| 10MB        | 150ms     | 3ms           | 50x     |
| 100MB       | 1500ms    | 15ms          | 100x    |

_Results vary by hardware and browser_

## 🐛 Troubleshooting

**Buffer not neutered?**

- Ensure you're using `transfer(buffer, [buffer])` syntax
- Check browser supports transferable objects (all modern browsers do)

**Slow transfers?**

- Verify buffer size is large enough (>100KB) to see benefits
- Check if other extensions are interfering with worker communication

**Errors in console?**

- Open browser DevTools and check Network/Console tabs
- Ensure worker file is served correctly (no 404 errors)

## 📚 Learn More

- [MDN: Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [kkrpc Documentation](https://kunkunsh.github.io/kkrpc/)
- [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
