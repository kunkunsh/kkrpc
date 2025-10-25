# kkrpc Transferable Object Implementation Plan

This document outlines a plan to implement transferable object support in `kkrpc`, drawing inspiration from `comlink`. The goal is to enable high-performance, zero-copy data transfer for supported transports while maintaining backward compatibility with the existing architecture.

## 1. Feature Comparison: `kkrpc` vs. `comlink`

| Feature | `kkrpc` | `comlink` |
| :--- | :--- | :--- |
| **Communication** | ✅ **Bidirectional**: Both client and server can expose and call APIs. | 🟡 **Mostly Unidirectional**: Designed for a primary context (e.g., main thread) to control a secondary one (e.g., worker). |
| **Transports** | ✅ **Multi-Transport**: Supports `stdio`, `HTTP`, `WebSocket`, Web Workers, and iframes. | ❌ **Single-Transport Focus**: Built exclusively for `postMessage`-based transports (Workers, iframes, MessageChannel). |
| **API Surface** | ✅ **Dynamic Proxy**: `getAPI()` creates a fully dynamic proxy for remote methods and properties. | ✅ **Proxy-based**: `wrap()` creates a proxy for the remote object. |
| **Property Access**| ✅ **Full Support**: Supports remote property getting (`await api.prop`) and setting (`api.prop = val`). | ❌ **No**: Only supports method calls. |
| **Serialization** | 🟡 **String-based**: Serializes messages to strings using `superjson`, which handles complex types but involves overhead. | ✅ **Object-based**: Uses the structured clone algorithm native to `postMessage`, which is highly efficient. |
| **Transferables** | ❌ **Not Supported**: All data is serialized and copied. | ✅ **First-Class Support**: Provides `Comlink.transfer()` for zero-copy transfer of `ArrayBuffer` and other `Transferable` objects. |
| **Extensibility** | 🟡 **Adapters**: New transports can be added by implementing the `IoInterface`. | ✅ **Transfer Handlers**: Allows custom serialization logic for non-transferable types. |

### Summary

- **`kkrpc`** excels in flexibility, offering true bidirectional communication across a wide range of JavaScript runtimes and transport protocols. Its weakness is the performance overhead from string-based serialization, especially for large binary data.
- **`comlink`** is highly specialized and optimized for `postMessage` environments, offering superior performance for large data via transferable objects, but it is not suitable for non-browser or non-worker contexts.

This plan aims to bring `comlink`'s zero-copy performance to `kkrpc`'s `postMessage`-based transports without sacrificing its multi-transport flexibility.

## 2. Implementation Plan

The core challenge is that `kkrpc`'s `IoInterface` is string-based (`write(data: string)`), while transferable objects require passing an array of `Transferable` objects alongside the main message to `postMessage`. This plan introduces a backward-compatible way to upgrade the IO pipeline.

### Phase 1: Core API & Type Definitions

The first step is to introduce the user-facing API for marking objects as transferable and to define the core interfaces for handling them.

1.  **Create `packages/kkrpc/src/transfer.ts`**: This new file will house all transferable-related logic.
2.  **Define `transfer()` Function**: Create a `transfer()` helper function that allows users to mark an object and its associated `Transferable` parts. This function will use a `WeakMap` to store the metadata.

    ```typescript
    // packages/kkrpc/src/transfer.ts
    export const transferCache = new WeakMap<object, Transferable[]>();

    export function transfer<T>(value: T, transferables: Transferable[]): T {
      if (typeof value !== 'object' || value === null) {
        throw new Error('The first argument to transfer() must be an object.');
      }
      transferCache.set(value, transferables);
      return value;
    }
    ```
3.  **Define `TransferHandler` System**: To support complex objects that contain transferable parts, we will replicate `comlink`'s `TransferHandler` pattern.

    ```typescript
    // packages/kkrpc/src/transfer.ts
    export interface TransferHandler<T, S> {
      canHandle(value: unknown): value is T;
      serialize(value: T): [S, Transferable[]];
      deserialize(value: S, transferables?: Transferable[]): T;
    }

    export const transferHandlers = new Map<string, TransferHandler<unknown, unknown>>();
    ```

### Phase 2: Evolve the IO Layer

To avoid breaking changes, we will enhance the `IoInterface` and adapters in an opt-in manner.

1.  **Enhance `IoInterface`**: Add an optional `writeRaw` method. The `RPCChannel` will use this method if it exists, otherwise it will fall back to the existing `write` method.

    ```typescript
    // packages/kkrpc/src/interface.ts
    export interface IoInterface {
      name: string;
      read(): Promise<Uint8Array | string | null>;
      write(data: string): Promise<void>;
      
      // Optional enhancement for transferable support
      writeRaw?(data: any, transfers: Transferable[]): Promise<void>;
    }
    ```
2.  **Update `postMessage` Adapters**: Modify `WorkerParentIO`, `WorkerChildIO`, and `Iframe` IO classes to implement `writeRaw`.

    ```typescript
    // packages/kkrpc/src/adapters/worker.ts (Example for WorkerParentIO)
    export class WorkerParentIO implements DestroyableIoInterface {
      // ... existing code ...

      write(data: string): Promise<void> {
        this.worker.postMessage(data);
        return Promise.resolve();
      }

      writeRaw(data: any, transfers: Transferable[]): Promise<void> {
        this.worker.postMessage(data, transfers);
        return Promise.resolve();
      }
    }
    ```
3.  **Update Message Handling**: The `onmessage` handlers in these adapters must now be able to differentiate between a string payload (from a legacy peer) and an object payload (from a peer that supports transferables).

### Phase 3: `RPCChannel` and Serialization Logic

This phase integrates the new capabilities into the core channel logic.

1.  **Argument Processing**: Before sending a message, `RPCChannel` must process its arguments to extract transferables. A new private method, `_processArgs`, will be created.

    ```typescript
    // packages/kkrpc/src/channel.ts
    private _processArgs(args: any[]): [any[], Transferable[]] {
      const transferables: Transferable[] = [];
      
      const processedArgs = args.map(arg => {
        if (typeof arg !== 'object' || arg === null) return arg;

        // 1. Check the transfer() cache
        const cached = transferCache.get(arg);
        if (cached) {
          transferables.push(...cached);
          // Replace with a placeholder
          return { __kkrpc_transferable__: true, index: transferables.length - cached.length };
        }

        // 2. Check transfer handlers (omitted for brevity)

        return arg;
      });

      return [processedArgs, transferables];
    }
    ```
2.  **Conditional Sending Logic**: The `callMethod` in `RPCChannel` will be updated.

    ```typescript
    // packages/kkrpc/src/channel.ts
    public callMethod<T extends keyof RemoteAPI>(method: T, args: any[]): Promise<any> {
      // ... promise setup ...

      const [processedArgs, transferables] = this._processArgs(args);
      const message: Message = { /* ... */, args: processedArgs };

      if (this.io.writeRaw && transferables.length > 0) {
        // New path: send raw object with transferables
        this.io.writeRaw(message, transferables);
      } else {
        // Old path: stringify and send
        this.io.write(serializeMessage(message, this.serializationOptions));
      }
    }
    ```
3.  **Message Reconstruction**: The `handleRequest` and `handleResponse` methods will need to reconstruct the arguments if they receive a raw message object with placeholders. The transferred data will be implicitly available on the `MessageEvent` in the adapter and will need to be passed up to the channel.

### Phase 4: Testing

A robust testing strategy is crucial to ensure correctness and prevent regressions.

1.  **Unit Tests**:
    *   Test the `transfer()` function and `transferCache`.
    *   Test the `_processArgs` logic for correctly identifying and extracting transferables.
2.  **Integration Tests**:
    *   Create a new test file, e.g., `__tests__/transferable.test.ts`.
    *   **Success Case**: Use a `Worker` transport. Send an `ArrayBuffer` marked with `transfer()`. Assert that the worker receives it and that the original buffer is neutered (`byteLength === 0`).
    *   **Fallback Case**: Use a `NodeIo` (stdio) transport. Send an `ArrayBuffer` marked with `transfer()`. Assert that the child process receives a serialized version of the buffer and that the original buffer is **not** neutered.
    *   **Bidirectional Test**: Ensure transferables can be sent in both directions.

## 3. Conclusion

This plan introduces transferable object support as a progressive enhancement. It prioritizes backward compatibility by making the new functionality opt-in at the adapter level and providing a seamless fallback to serialization for transports that do not support zero-copy transfer. By adopting `comlink`'s successful patterns, `kkrpc` can gain significant performance benefits in browser-based environments, further solidifying its position as a versatile, high-performance RPC library for the modern web.
