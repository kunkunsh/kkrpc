# kkrpc - LEGACY ADAPTERS DIRECTORY

## OVERVIEW

This directory contains legacy adapter source retained during the native migration. Stable public code should prefer native transport factories under `src/transports/` and package subpaths such as `kkrpc/worker`, `kkrpc/ws`, `kkrpc/http`, `kkrpc/electron`, and queue-specific entries.

## CURRENT DIRECTION

- Stable channels consume `Transport<RPCMessage>`.
- Native transports use `send(message, transfers?)`, `subscribe(listener)`, and optional `close()`.
- Runtime-specific and optional-peer transports stay behind subpath exports.
- Do not import legacy adapters into the main `kkrpc` entry.

## NATIVE TRANSPORT PATTERN

```typescript
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export function runtimeTransport(endpoint: RuntimeEndpoint): Transport<RPCMessage> {
	return {
		capabilities: { objectMode: true, transfer: false },
		send(message) {
			endpoint.send(JSON.stringify(message))
		},
		subscribe(listener) {
			const handler = (raw: string) => listener(JSON.parse(raw) as RPCMessage)
			endpoint.on("message", handler)
			return () => endpoint.off("message", handler)
		},
		close() {
			endpoint.close()
		}
	}
}
```

## ANTI-PATTERNS

- Do not add new stable examples that depend on legacy adapter classes.
- Do not import optional peers from the main package entry.
- Do not add compatibility bridges for removed public API names unless a migration task explicitly asks for them.
