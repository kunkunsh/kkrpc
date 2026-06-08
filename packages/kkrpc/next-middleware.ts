/**
 * @module kkrpc/next/middleware
 * @description Optional interceptor middleware plugin for kkrpc/next.
 *
 * Import this entry when calls need receive-side policies such as auth,
 * logging, argument rewriting, tracing, or blocking. Middleware stays optional
 * so core users do not pay for interceptor helpers.
 */

export * from "./src/next/middleware.ts"
