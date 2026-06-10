/**
 * Stable browser-safe core package entry published as `kkrpc`.
 *
 * Import this entry for `RPCChannel`, `wrap()`, `expose()`, protocol types,
 * plugin primitives, codecs, and transfer helpers. Runtime transports and
 * optional peer-backed features intentionally live in subpaths so the main entry
 * stays portable across Node.js, Bun, Deno, browsers, workers, and bundlers.
 *
 * ```ts
 * import { wrap } from "kkrpc"
 * import { webSocketClientTransport } from "kkrpc/ws"
 *
 * const api = wrap<RemoteAPI>(webSocketClientTransport({ url: "ws://localhost:3000" }))
 * ```
 */
export * from "../core/index.ts"
