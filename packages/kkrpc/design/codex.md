## Transferable Object Support Plan for `kkrpc`

### 1. Snapshot: Comlink vs kkrpc
- **Transfer semantics**  
  - Comlink: `Comlink.transfer(value, transfers)` caches transfer lists per object (`packages/comlink/src/comlink.ts:578`), passes them through `toWireValue` and forwards to `postMessage` as the second argument.  
  - kkrpc: No concept of transferables; every payload is superjson/JSON stringified before hitting adapters like `packages/kkrpc/src/channel.ts:118` (method calls) and `packages/kkrpc/src/adapters/worker.ts:43` (worker IO).
- **Wire format**  
  - Comlink: Structured-clone friendly objects; message envelope already supports transfer lists.  
  - kkrpc: String-based framing (`serializeMessage` in `packages/kkrpc/src/serialization.ts:88`), which strips structured clone types and prevents zero-copy transfer.
- **Adapter surface**  
  - Comlink: Endpoint abstraction exposes `postMessage(msg, transferables?)`.  
  - kkrpc: `IoInterface.write(data: string)` (see `packages/kkrpc/src/interface.ts:11`) accepts only strings, so transport capabilities are opaque.
- **Extensibility hooks**  
  - Comlink: `transferHandlers` and `proxy()` to customize serialization.  
  - kkrpc: Custom serialization depends on superjson plugin support; no hook for transfer metadata.

### 2. Goals for Transferable Support in kkrpc
- Preserve the ergonomic API (`rpc.getAPI()`) while allowing users to mark arguments/return values for zero-copy transfer across `postMessage`-based transports.
- Maintain backward compatibility with existing transports (stdio, HTTP, WebSocket, etc.) where transferables are meaningless.
- Keep superjson as default cloning mechanism for non-transferable payloads.
- Minimize breaking changes to current adapter API surface, but allow opt-in upgrades where needed.

### 3. Proposed Architecture Changes

#### 3.1 Transfer Marking API
- Introduce `transfer<T>(value: T, transferables: Transferable[]): T` in a new `packages/kkrpc/src/transfer.ts` (exported via `mod.ts` and browser entry).  
  - Internally maintain a `WeakMap<object, TransferDescriptor>` similar to Comlink’s cache.  
  - `TransferDescriptor` should track both the `Transferable[]` and optional metadata describing how to rehydrate in non-transfer transports (e.g., fall back to cloning).
- Provide optional `registerTransferHandler(name, handler)` API for future extensibility (mirroring Comlink) but keep it minimal in initial scope.

```ts
// packages/kkrpc/src/transfer.ts
export interface TransferDescriptor {
	value: unknown;
	transfers: Transferable[];
	handler?: string;                // reserved for custom handlers
}

const transferCache = new WeakMap<object, TransferDescriptor>();

export function transfer<T extends object>(
	value: T,
	transfers: Transferable[]
): T {
	transferCache.set(value, { value, transfers });
	return value;
}

export function takeTransferDescriptor(value: unknown): TransferDescriptor | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const descriptor = transferCache.get(value as object);
	if (descriptor) transferCache.delete(value as object);
	return descriptor;
}
```

```ts
// packages/kkrpc/src/transfer.ts (optional extension point)
export type TransferHandler = {
	canHandle(value: unknown): boolean;
	serialize(value: unknown): TransferDescriptor;
	deserialize(payload: unknown): unknown;
};

const transferHandlers = new Map<string, TransferHandler>();

export function registerTransferHandler(name: string, handler: TransferHandler) {
	transferHandlers.set(name, handler);
}
```

#### 3.2 Message Envelope & Serialization
- Define a v2 wire envelope:
  ```ts
  interface WireEnvelope {
    version: 2;
    payload: Message<any>;          // Same shape as today
    transferSlots?: number[];       // Indexes into argument arrays/values that carry transfer markers
    encoding?: "string" | "object"; // Transport hint
  }
  ```
- Adjust `serializeMessage` / `deserializeMessage` (`packages/kkrpc/src/serialization.ts`) to expose two pathways:
  1. **String mode (default)** – identical to current behaviour for legacy transports.
  2. **Structured-clone mode** – skip stringifying when the caller indicates a transfer and return raw `Message` objects alongside transfer metadata.
- Update `RPCChannel` methods (`packages/kkrpc/src/channel.ts:121`, `:172`, `:225`) to detect `transfer()` markers when processing arguments/return values.  
  - Extract transfer metadata before calling `this.io.write()` and hand both serialized payload plus transfer list to the IO layer.  
  - On receipt (`handleRequest`, `handleResponse`, etc.) re-associate transferables with their slots.

```ts
// packages/kkrpc/src/serialization.ts
export interface Message<T = any> {
	id: string;
	method: string;
	args: T;
	type: MessageType;
	callbackIds?: string[];
	version?: "json" | "superjson";
	path?: string[];
	value?: unknown;
	transferSlots?: number[]; // new optional mapping
}
```

```ts
// packages/kkrpc/src/serialization.ts
export type EncodedMessage =
	| { mode: "string"; data: string }
	| { mode: "structured"; data: WireEnvelope };

export function encodeMessage<T>(
	message: Message<T>,
	options: SerializationOptions,
	withTransfers: boolean
): EncodedMessage {
	if (!withTransfers) {
		return { mode: "string", data: serializeWithSuperjson(message, options) };
	}
	const envelope: WireEnvelope = {
		version: 2,
		payload: message,
		encoding: "object"
	};
	return { mode: "structured", data: envelope };
}

export function decodeMessage<T>(
	raw: string | WireEnvelope
): Message<T> {
	if (typeof raw === "string") {
		return deserializeMessage<T>(raw);
	}
	return raw.payload as Message<T>;
}
```

```ts
// Example marker extraction inside channel.ts
const processedArgs = args.map((arg, index) => {
	const descriptor = takeTransferDescriptor(arg);
	if (descriptor) {
		transferSlots.push(index);
		transfers.push(...descriptor.transfers);
		return descriptor.value; // structured clone-safe payload
	}
	return arg;
});
```

#### 3.3 IO Interface Upgrade
- Introduce a backward-compatible enhancement to `IoInterface`:
  ```ts
  export interface IoMessage {
    data: string | Message<any> | WireEnvelope;
    transfers?: Transferable[];
  }
  export interface IoInterface {
    name: string;
    read(): Promise<IoMessage | string | null>;
    write(message: IoMessage | string): Promise<void>;
    readonly capabilities?: { structuredClone?: boolean; transfer?: boolean };
  }
  ```
- Default adapters keep accepting strings (they ignore `transfers`).  
- Worker/Iframe adapters opt in:  
  - Accept `IoMessage` objects and call `postMessage(message.data, message.transfers)` when `capabilities.transfer` is true.  
  - For backward compatibility, continue to accept pure strings.
- Node Worker adapter (if present) should mirror browser behaviour using `worker.postMessage`.

```ts
// packages/kkrpc/src/interface.ts
export interface IoCapabilities {
	structuredClone?: boolean;
	transfer?: boolean;
}

export interface IoMessage {
	data: string | WireEnvelope;
	transfers?: Transferable[];
}

export interface IoInterface {
	name: string;
	read(): Promise<IoMessage | string | null>;
	write(message: IoMessage | string): Promise<void>;
	capabilities?: IoCapabilities;
}
```

```ts
// packages/kkrpc/src/adapters/worker.ts
export class WorkerParentIO implements DestroyableIoInterface {
	capabilities = { structuredClone: true, transfer: true };

	async write(message: IoMessage | string): Promise<void> {
		if (typeof message === "string") {
			this.worker.postMessage(message);
			return;
		}
		this.worker.postMessage(message.data, message.transfers ?? []);
	}

	async read(): Promise<IoMessage | string | null> {
		// wrap existing queue logic and convert incoming structured messages back to IoMessage
	}
}
```

#### 3.4 Message Processing Pipeline
- Extend callback placeholders and property get/set flows to honour transfer markers on both arguments and results.  
  - When `sendResponse` is invoked with a transferred value (`packages/kkrpc/src/channel.ts:306`), ensure returned message carries matching transfer metadata.
  - When receiving callbacks (`handleCallback`), unwrap potential transferables for callback arguments.
- Ensure serialization fallbacks apply when the receiving side lacks `capabilities.transfer`:
  - If sender marks transfer but IO cannot transfer, either throw (opt-in strict mode) or downgrade to cloning (default). Add configuration knob on `RPCChannel` constructor.

```ts
// packages/kkrpc/src/channel.ts (excerpt)
private emit(message: Message, transfers: Transferable[], transferSlots: number[]) {
	const supportsTransfer = this.io.capabilities?.transfer === true;
	const encoded = encodeMessage(
		{ ...message, transferSlots: transferSlots.length ? transferSlots : undefined },
		this.serializationOptions,
		supportsTransfer && transfers.length > 0
	);
	if (encoded.mode === "string") {
		return this.io.write(encoded.data);
	}
	return this.io.write({ data: encoded.data, transfers });
}

private sendResponse<T>(id: string, result: T): void {
	const transferSlots: number[] = [];
	const transfers: Transferable[] = [];
	const processedResult = unwrapTransferResult(result, transferSlots, transfers);
	const response: Message<Response<T>> = {
		id,
		method: "",
		args: { result: processedResult },
		type: "response"
	};
	this.emit(response, transfers, transferSlots);
}
```

```ts
// Deserializing transfers on receive
const wire = await this.io.read();
const message = decodeMessage<Message<any>>(
	typeof wire === "string" ? wire : wire.data
);
if (Array.isArray(message.args?.argumentList)) {
	message.args.argumentList = rehydrateTransfersIntoArgs(
		message.args.argumentList,
		typeof wire === "string" ? [] : wire.transfers ?? [],
		message.transferSlots ?? []
	);
}
```

```ts
// packages/kkrpc/src/transfer.ts
export function unwrapTransfersFromArgs(
	rawArgs: unknown[],
	transferSlots: number[],
	transfers: Transferable[]
): unknown[] {
	return rawArgs.map((arg, index) => {
		const descriptor = takeTransferDescriptor(arg);
		if (descriptor) {
			transferSlots.push(index);
			transfers.push(...descriptor.transfers);
			return descriptor.value;
		}
		return arg;
	});
}

export function rehydrateTransfersIntoArgs(
	rawArgs: unknown[],
	transfers: Transferable[],
	transferSlots: number[]
): unknown[] {
	return rawArgs.map((arg, index) => {
		const slotIdx = transferSlots.indexOf(index);
		if (slotIdx === -1) return arg;
		const transfer = transfers[slotIdx];
		return Object.assign(arg as object, { __transferred__: transfer });
	});
}

export function unwrapTransferResult(
	value: unknown,
	transferSlots: number[],
	transfers: Transferable[]
): unknown {
	const descriptor = takeTransferDescriptor(value);
	if (!descriptor) return value;
	transferSlots.push(0);
	transfers.push(...descriptor.transfers);
	return descriptor.value;
}
```

#### 3.5 Public API & Documentation
- Expose `transfer` helper (and potential `registerTransferHandler`) from primary entry points (`packages/kkrpc/mod.ts`, `browser-mod.ts`, `deno-mod.ts`).  
- Update README sections that discuss binary data / performance to mention the new APIs and transport caveats.
- Provide usage examples for worker and iframe transports demonstrating zero-copy transfer.

```ts
// packages/kkrpc/browser-mod.ts
export { transfer } from "./src/transfer.ts";

// Typical usage
const rpc = new RPCChannel(new WorkerParentIO(worker), { expose: api });
const remote = rpc.getAPI();

const frame = new Uint8Array(largeArrayBuffer);
await remote.renderFrame(transfer(frame, [frame.buffer]));
```

### 4. Implementation Phases

1. **Transport capability scaffolding**  
   - Extend `IoInterface` + adapters with capability flags and accept richer message objects.  
   - Add type guards/utilities in `packages/kkrpc/src/utils.ts` for envelope detection.
2. **Serialization bifurcation**  
   - Refactor `serializeMessage`/`deserializeMessage` to support both string and object pathways without breaking existing tests.  
   - Add unit coverage to capture old vs new modes.
3. **Transfer marker plumbing**  
   - Implement `transferCache` utility and integrate with `RPCChannel.callMethod/callConstructor/setProperty` pipelines for outgoing messages.  
   - Mirror logic in `handleRequest/handleResponse` to rehydrate and clear caches.
4. **Adapter upgrades**  
   - Update worker/iframe adapters to send `postMessage` with transfer lists.  
   - Create a Node worker adapter variant or extend existing `packages/kkrpc/src/adapters/node.ts` if applicable.  
   - Ensure transports that cannot transfer continue to work (stdio/http/websocket untouched).
5. **API surface & docs**  
   - Export helpers, add TypeDoc annotations, and drop documentation updates + migration notes.  
   - Provide integration tests covering worker transfer scenario and fallback when transfer unavailable.
6. **Optional phase**: pluggable transfer handlers  
   - If time permits, add registry allowing custom handlers (e.g., for DOM events) similar to Comlink’s `transferHandlers`.

### 5. Risks & Open Questions
- **Backward compatibility**: Need to confirm no existing user is destructuring the string payload; consider feature flag or version gate.  
- **Superjson interaction**: Validate that keeping structured-clone pathways doesn’t double-encode data; may require using `superjson.serialize`/`deserialize` APIs directly.  
- **Cross-runtime parity**: Determine behaviour for Deno/Bun worker transports (ensure `postMessage` signature matches browsers).  
- **Memory management**: After transferring, source buffers become neutered; document this clearly to avoid developer surprise.  
- **Testing coverage**: Requires environment with real `Worker` support in CI for reliable regression tests.

### 6. Deliverables
- Source changes across serialization, channel, adapters, and new transfer helper.  
- Documentation updates (README + TypeDoc) highlighting transfer usage and limitations.  
- Automated tests demonstrating zero-copy transfer in worker transport and fallback behaviour elsewhere.  
- Migration notes clarifying impact on adapter authors and custom IO implementations.
