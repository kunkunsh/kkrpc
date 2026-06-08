/**
 * @module kkrpc/next
 * @description Minimal vNext RPC core: channel, proxy helpers, protocol types, transport types, and plugin types.
 *
 * Import this entry when you already have a `Transport<RPCMessage>` or when a
 * separate transport entry provides one. This entry intentionally excludes
 * validation, middleware, SuperJSON, stdio, Worker transport, and classic
 * compatibility so browser bundlers can tree-shake unused features.
 *
 * @example
 * ```ts
 * import { expose, wrap } from "kkrpc/next"
 *
 * expose({ ping: () => "pong" }, serverTransport)
 * const api = wrap<{ ping(): Promise<string> }>(clientTransport)
 * await api.ping()
 * ```
 */
export * from "./src/next/index.ts"
