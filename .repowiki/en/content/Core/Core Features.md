# Core Features

<cite>
**Referenced Files in This Document**
- [packages/kkrpc/src/channel.ts](file://packages/kkrpc/src/channel.ts)
- [packages/kkrpc/src/validation.ts](file://packages/kkrpc/src/validation.ts)
- [packages/kkrpc/src/middleware.ts](file://packages/kkrpc/src/middleware.ts)
- [packages/kkrpc/src/serialization.ts](file://packages/kkrpc/src/serialization.ts)
- [.journal/2026-02-07.md](file://.journal/2026-02-07.md)
</cite>

## Table of Contents

1. [Remote API Proxies](#remote-api-proxies)
2. [Runtime Validation](#runtime-validation)
3. [Middleware](#middleware)
4. [Transferable Objects](#transferable-objects)
5. [Recent Feature Additions](#recent-feature-additions)

## Remote API Proxies

`RPCChannel.getAPI()` returns a nested proxy that turns property reads, property writes, function
calls, and constructor calls into protocol messages. Dotted method paths are assembled from proxy
property access, while the special `then` trap allows `await api.some.property` to issue a remote
property read.

**Section sources**

- [packages/kkrpc/src/channel.ts](file://packages/kkrpc/src/channel.ts#L304-L459)
- [packages/kkrpc/src/channel.ts](file://packages/kkrpc/src/channel.ts#L1092-L1137)

## Runtime Validation

Validation is optional and Standard Schema based. Users can either pass a validator map that
mirrors their API shape or define methods schema-first with `defineMethod` and collect validators
with `extractValidators`. Input validation runs before handler invocation; output validation runs
after handler invocation, and stream output validation runs per chunk.

**Section sources**

- [packages/kkrpc/src/validation.ts](file://packages/kkrpc/src/validation.ts#L1-L17)
- [packages/kkrpc/src/validation.ts](file://packages/kkrpc/src/validation.ts#L51-L97)
- [packages/kkrpc/src/validation.ts](file://packages/kkrpc/src/validation.ts#L103-L144)
- [packages/kkrpc/src/validation.ts](file://packages/kkrpc/src/validation.ts#L166-L220)
- [packages/kkrpc/src/channel.ts](file://packages/kkrpc/src/channel.ts#L551-L590)
- [packages/kkrpc/src/channel.ts](file://packages/kkrpc/src/channel.ts#L818-L829)

## Middleware

Middleware is modeled as an onion-style interceptor chain. Interceptors run after input validation
and before output validation, receive the dotted method name, validated arguments, and a shared
state object, and call `next()` to continue to the next interceptor or the handler.

**Section sources**

- [packages/kkrpc/src/middleware.ts](file://packages/kkrpc/src/middleware.ts#L1-L12)
- [packages/kkrpc/src/middleware.ts](file://packages/kkrpc/src/middleware.ts#L14-L33)
- [packages/kkrpc/src/middleware.ts](file://packages/kkrpc/src/middleware.ts#L35-L60)
- [packages/kkrpc/src/channel.ts](file://packages/kkrpc/src/channel.ts#L572-L583)

## Transferable Objects

Adapters declare whether they support structured clone and zero-copy transfer. When enabled,
`RPCChannel` processes arguments, property values, and responses into transfer slots and sends a
structured object envelope rather than a string message.

**Section sources**

- [packages/kkrpc/src/interface.ts](file://packages/kkrpc/src/interface.ts#L7-L27)
- [packages/kkrpc/src/channel.ts](file://packages/kkrpc/src/channel.ts#L164-L172)
- [packages/kkrpc/src/channel.ts](file://packages/kkrpc/src/channel.ts#L325-L345)
- [packages/kkrpc/src/channel.ts](file://packages/kkrpc/src/channel.ts#L995-L1058)
- [packages/kkrpc/src/serialization.ts](file://packages/kkrpc/src/serialization.ts#L47-L61)
- [packages/kkrpc/src/serialization.ts](file://packages/kkrpc/src/serialization.ts#L159-L190)

## Recent Feature Additions

The 2026-02-07 development journal records completion of request timeouts, targeted type-safety
cleanup, AsyncIterable streaming, optional peer dependency cleanup, and WebSocket structural typing
for server-side compatibility with DOM WebSocket, `ws`, and Bun server sockets.

**Section sources**

- [.journal/2026-02-07.md](file://.journal/2026-02-07.md#L3-L47)
- [.journal/2026-02-07.md](file://.journal/2026-02-07.md#L48-L87)
- [.journal/2026-02-07.md](file://.journal/2026-02-07.md#L88-L167)
