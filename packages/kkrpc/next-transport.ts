/**
 * @module kkrpc/next/transport
 * @description Transport, platform, codec interfaces, and `createTransport()` composition helper.
 *
 * Import this entry when building a new transport or combining a runtime
 * platform with a codec. It is dependency-light and does not import the RPC
 * channel or optional feature plugins.
 */
export * from "./src/next/transport.ts"
