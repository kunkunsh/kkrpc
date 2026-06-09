# kkrpc - CORE SOURCE DIRECTORY

## OVERVIEW

Core RPC engine for the stable native architecture: bidirectional channel, proxy API, plugin hooks, transfer descriptors, protocol types, and transport composition.

## STRUCTURE

```
src/
├── core/              # Stable RPCChannel, protocol, plugins, transport primitives
├── transports/        # Native runtime transport factories
├── features/          # Optional validation, middleware, SuperJSON features
├── relay.ts           # Transport relay helper
└── adapters/          # Legacy adapter source retained until cleanup tasks remove it
```

## KEY FILES

| File | Role |
| --- | --- |
| `core/channel.ts` | Stable `RPCChannel` and proxy implementation |
| `core/protocol.ts` | Compact `RPCMessage` protocol union |
| `core/transport.ts` | `Transport`, `Platform`, `Codec`, and `createTransport()` |
| `core/plugins.ts` | Plugin lifecycle hooks |
| `core/transfer.ts` | Transfer descriptor helpers |
| `transports/*.ts` | Runtime-specific native transports |
| `features/*.ts` | Optional feature plugins/codecs |

## IMPLEMENTATION PATTERNS

### Message Protocol

Stable messages use compact request, response, and callback records. Methods use path arrays that are exposed to plugin contexts as dot-joined method names.

### Transport Capabilities

`TransportCapabilities` describe object mode, transfer support, and broadcast support. `RPCChannel` checks `transport.capabilities?.transfer` before forwarding transferables.

### Plugin Hooks

Plugins can inspect requests, wrap local handler execution, observe responses, and observe errors. Validation, middleware, and inspector helpers are implemented as plugins.

### Transfer Descriptor WeakMap

`WeakMap<object, TransferDescriptor>` marks transferables via `transfer()`. `takeTransferDescriptor()` consumes and deletes descriptors to avoid leaks.
