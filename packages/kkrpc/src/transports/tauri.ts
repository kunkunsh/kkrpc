/**
 * Tauri shell stdio transport for stable kkrpc.
 *
 * This adapter maps Tauri shell stdout and child process writes into the shared
 * JSON-line stdio transport. It is bidirectional when the spawned process reads
 * stdin and writes stdout, supports callbacks, and does not support transferables.
 */

import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"
import { stdioJsonTransport, type ReadableLike } from "./stdio.ts"

/** Tauri stdout stream shape consumed by the stdio transport. */
export interface TauriShellStdout extends ReadableLike {}

/** Tauri shell child process shape used for stdin writes. */
export interface TauriShellChild {
	write(chunk: string): unknown
}

/** Options for creating a Tauri shell stdio transport. */
export interface TauriShellStdioTransportOptions {
	stdout: TauriShellStdout
	child: TauriShellChild
}

/**
 * Create a transport over a Tauri shell child process.
 *
 * The returned transport inherits stdio lifecycle behavior; writes are delegated
 * to `child.write()` and stdout frames are parsed as newline-delimited JSON.
 */
export function tauriShellStdioTransport(
	options: TauriShellStdioTransportOptions
): Transport<RPCMessage> {
	return stdioJsonTransport({
		readable: options.stdout,
		writable: {
			write(chunk, callback) {
				try {
					Promise.resolve(options.child.write(chunk)).then(
						() => callback?.(),
						(error) => callback?.(error instanceof Error ? error : new Error(String(error)))
					)
				} catch (error) {
					callback?.(error instanceof Error ? error : new Error(String(error)))
				}
			}
		}
	})
}
