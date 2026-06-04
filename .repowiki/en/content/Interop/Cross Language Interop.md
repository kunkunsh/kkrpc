# Cross Language Interop

<cite>
**Referenced Files in This Document**
- [interop/README.md](file://interop/README.md)
- [packages/kkrpc/src/serialization.ts](file://packages/kkrpc/src/serialization.ts)
</cite>

## Table of Contents

1. [Interop Scope](#interop-scope)
2. [Protocol Subset](#protocol-subset)
3. [Language Implementations](#language-implementations)
4. [Design Constraints](#design-constraints)

## Interop Scope

The `interop` directory documents and implements a JSON-only compatibility layer so non-JavaScript
runtimes can communicate with a TypeScript kkrpc endpoint over line-delimited stdio or WebSocket
text frames.

**Section sources**

- [interop/README.md](file://interop/README.md#L1-L15)

## Protocol Subset

The interop protocol uses the same request, response, callback, get, set, and construct message
types as the TypeScript implementation, but targets `version: "json"` rather than requiring
SuperJSON. Callback arguments are encoded as `__callback__<id>` markers.

**Section sources**

- [interop/README.md](file://interop/README.md#L17-L48)
- [packages/kkrpc/src/serialization.ts](file://packages/kkrpc/src/serialization.ts#L8-L28)
- [packages/kkrpc/src/serialization.ts](file://packages/kkrpc/src/serialization.ts#L131-L156)

## Language Implementations

The draft README lists Python, Go, and Rust implementations with stdio and WebSocket examples and
test commands. Node test servers expose a shared API for compatibility verification.

**Section sources**

- [interop/README.md](file://interop/README.md#L50-L92)
- [interop/README.md](file://interop/README.md#L94-L122)
- [interop/README.md](file://interop/README.md#L124-L158)

## Design Constraints

The current interop layer intentionally omits transfer slots and structured clone support. That
keeps the cross-language baseline small: implement newline-delimited JSON, the common message
shape, IDs, and callback placeholders first; add richer JS-specific serialization later only when a
target runtime needs it.

**Section sources**

- [interop/README.md](file://interop/README.md#L159-L163)
- [packages/kkrpc/src/serialization.ts](file://packages/kkrpc/src/serialization.ts#L47-L69)
