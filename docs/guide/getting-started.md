# Getting Started

> The purpose of this project is to provide a simple-to-use RPC framework for any environment JavaScript/TypeScript can run, not just http.

## Environment

- http
  - Make RPC calls over HTTP like calling local functions (similar to tRPC)
- WebSocket
  - Make RPC calls over WebSocket
- Web Worker
  - Make RPC calls over Web Worker (similar to [comlink](https://github.com/GoogleChromeLabs/comlink))
- iframe
  - Make RPC calls over iframe (similar to [comlink](https://github.com/GoogleChromeLabs/comlink))
- stdio
  - Make RPC calls over stdio between JavaScript/TypeScript processes (e.g. Node.js/Deno/Bun)

All environments (except for http) support bidirectional calls and callbacks.
i.e. both sides can expose API methods to each other on the same connection.

## Install

```bash
npm install kkrpc
```

## Recommended Prerequisites

- Node.js
- Bun
  - Use this to run TypeScript directly (without compiling to JavaScript)
