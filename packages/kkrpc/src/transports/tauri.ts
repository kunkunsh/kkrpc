import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"
import { stdioJsonTransport, type ReadableLike } from "./stdio.ts"

export interface TauriShellStdout extends ReadableLike {}

export interface TauriShellChild {
	write(chunk: string): unknown
}

export interface TauriShellStdioTransportOptions {
	stdout: TauriShellStdout
	child: TauriShellChild
}

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
