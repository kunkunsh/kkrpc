---
title: Relay
description: Create transparent bridges between transport layers
---

The `relayTransport()` helper forwards native `Transport<RPCMessage>` traffic between two endpoints. The relay does not need to know the exposed API shape.

```ts title="relay.ts"
import { relayTransport } from "kkrpc/relay"
import { nodeStdioTransport } from "kkrpc/stdio"
import { webSocketTransport } from "kkrpc/ws"

const relay = relayTransport(
	webSocketTransport(socket),
	nodeStdioTransport({ readable: child.stdout, writable: child.stdin })
)

// Later, when shutting down:
relay.dispose()
```

Use a relay when one process should act as a transparent bridge between two already-created transports.
