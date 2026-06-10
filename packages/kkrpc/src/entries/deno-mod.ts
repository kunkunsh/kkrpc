/**
 * Deno-friendly entry published for JSR and `kkrpc/deno` consumers.
 *
 * This entry exports the stable core APIs, worker transports, and generic stdio
 * primitives that can wrap Deno streams. It excludes the Node-bound default
 * stdio helper and optional peer-backed transports.
 *
 * ```ts
 * import { expose } from "@kunkun/kkrpc"
 * import { stdioJsonTransport } from "@kunkun/kkrpc"
 * ```
 * @module
 */

export * from "../core/index.ts"
export * from "../transports/worker.ts"
export { stdioJsonTransport, stdioPlatform } from "../transports/stdio.ts"
export type { ReadableLike, StdioPlatformOptions, WritableLike } from "../transports/stdio.ts"
