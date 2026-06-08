/**
 * @module kkrpc/next/superjson
 * @description Optional SuperJSON codecs for kkrpc/next transports.
 *
 * Import this entry when JSON needs to preserve values like `Date`, `Map`,
 * `Set`, or `BigInt`. It adds the `superjson` dependency and is therefore kept
 * outside the core `kkrpc/next` entry.
 */

export * from "./src/next/superjson.ts"
