/**
 * Published `kkrpc/ws` entry for WebSocket transports.
 *
 * Import this entry in Node.js, Bun, Deno, or browser clients that need a
 * WebSocket-backed `Transport<RPCMessage>`. Server runtimes can wrap accepted
 * socket objects with `webSocketTransport()`, while clients can use
 * `webSocketClientTransport()`.
 */
export * from "../transports/ws.ts"
