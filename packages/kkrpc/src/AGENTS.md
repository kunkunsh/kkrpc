# kkrpc - CORE SOURCE DIRECTORY

**Generated:** 2026-01-17
**Location:** packages/kkrpc/src

## OVERVIEW

Core RPC engine: bidirectional channel with proxy API, multi-format serialization, zero-copy transfers.

## STRUCTURE

```
src/
├── channel.ts            # RPCChannel, proxy API (761 lines)
├── interface.ts          # IoInterface abstraction (43 lines)
├── serialization.ts      # encode/decode, slots (314 lines)
├── transfer.ts           # transfer() marker (51 lines)
├── transfer-handlers.ts   # TransferHandler registry (23 lines)
└── utils.ts              # generateUUID() (11 lines)
```

## KEY_FILES

| File                 | Lines | Role                          |
| -------------------- | ----- | ----------------------------- |
| channel.ts           | 761   | RPCChannel, createNestedProxy |
| interface.ts         | 43    | IoInterface, IoCapabilities   |
| serialization.ts     | 314   | encodeMessage, decodeMessage  |
| transfer.ts          | 51    | transfer(), WeakMap cache     |
| transfer-handlers.ts | 23    | registerTransferHandler       |
| utils.ts             | 11    | generateUUID()                |

## IMPLEMENTATION_PATTERNS

### Message Protocol

Six types: request/response, callback, get/set (properties), construct. Methods use dot-notation paths.

### Proxy API Transformation

`createNestedProxy(chain)` Proxy traps: apply→callMethod(), construct→callConstructor(), get→getProperty(), set→setProperty(). Special `then` trap enables `await api.prop`.

### Transport Capabilities

`IoCapabilities`: structuredClone (IoMessage), transfer (zero-copy), transferTypes. RPCChannel checks `io.capabilities` to auto-enable transfers.

### Serialization Auto-Detection

`message.startsWith('{"json":')` → superjson.parse(), else JSON.parse(). Backward compatible.

### Enhanced Error Preservation

`EnhancedError`: name, message, stack, cause, plus all custom properties preserved across boundaries.

### Transfer Slot System

Zero-copy tracking: transferables → `"__kkrpc_transfer_N"` IDs. `TransferSlot` (raw/handler), `WireEnvelope` v2 format (version, payload, encoding, slots).

### ID Management

Pending requests: `Record<string, {resolve, reject}>` maps UUIDs to resolvers. Callbacks: `Map<Function, string>` prevents dupes, serialized as `"__callback__${id}"`. Both use `generateUUID()`.

### Stdio Message Buffering

`bufferString(chunk)` accumulates, splits on `\n`, processes JSON, retains remainder. Non-JSON logged for debugging.

### Transfer Descriptor WeakMap

`WeakMap<object, TransferDescriptor>` marks transferables via `transfer()`. `takeTransferDescriptor()` consumes/deletes. WeakMap prevents GC leaks.

## CONVENTIONS

- Message IDs: 4-part hex UUID joined with `-`
- Callback IDs: UUID with `__callback__` prefix
- Transfer slots: `__kkrpc_transfer_` + index
- String transport termination: `\n`
- Error properties: All custom fields preserved
