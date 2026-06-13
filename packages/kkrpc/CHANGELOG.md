# kkrpc

## 2.0.0

### Major Changes

- Keep the default `kkrpc` entry slim by moving streaming support to `kkrpc/streaming` and explicit remote references to `kkrpc/remote-refs`.
- Require explicit `proxy()` markers for remote references and reject unmarked function values instead of implicitly proxying them.
- Tighten HTTP and message-bus feature boundaries with clearer errors for unsupported callback, stream, and remote-reference envelopes.

## 0.4.0

### Minor Changes

- Add support for property access and error preservation

## 0.1.0

### Minor Changes

- Support Uin8Array and stdout passthrough
