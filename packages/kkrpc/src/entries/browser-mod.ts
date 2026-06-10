/**
 * Explicit browser-safe entry published as `kkrpc/browser`.
 *
 * This entry exports the stable core APIs plus browser-context transports for
 * Web Workers, iframes, Chrome extension ports, and the browser WebSocket client
 * helper. It excludes stdio, Electron, Tauri, and message-bus transports.
 *
 * ```ts
 * import { wrap } from "kkrpc/browser"
 * import { workerTransport } from "kkrpc/browser"
 * ```
 */

export * from "../core/index.ts"
export * from "../transports/worker.ts"
export * from "../transports/iframe.ts"
export * from "../transports/chrome-extension.ts"
export { webSocketClientTransport } from "../transports/web-socket-client.ts"
export type { WebSocketClientTransportOptions } from "../transports/web-socket-client.ts"
