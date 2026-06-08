/**
 * @module kkrpc/next/classic-compat
 * @description Optional migration facade for kkrpc/next validators and interceptors.
 *
 * Import this entry when migrating classic-style validator/interceptor options
 * to vNext plugins. It does not adapt classic `IoInterface` transports; callers
 * still provide a `Transport<RPCMessage>`.
 */

export * from "./src/next/classic-compat.ts"
