/**
 * @module kkrpc/next/stdio
 * @description JSON-line stdio platform and transport helpers for kkrpc/next.
 *
 * Import this entry for Node-style stdin/stdout or explicit child-process stream
 * pairs. It is separate from `kkrpc/next` so browser bundles avoid stdio code.
 */
export * from "./src/next/stdio.ts"
