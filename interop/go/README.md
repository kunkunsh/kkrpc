# kkrpc-interop (Go)

Go client/server library for kkrpc JSON-mode interop. This package mirrors the kkrpc
message protocol using JSON only, enabling cross-language RPC.

## Features

- JSON request/response compatible with kkrpc's stable compact `RPCMessage` protocol.
- `stdio` and `ws` transports with a shared `Transport` interface.
- Callback support using stable callback marker objects.

## Installation

When published:

```bash
go get kkrpc-interop
```

From this repository:

```bash
cd interop/go

go test ./...
```

## Usage

### Stdio client

```go
package main

import (
	"fmt"
	"os/exec"

	"kkrpc-interop/kkrpc"
)

func main() {
	cmd := exec.Command("bun", "interop/node/server.ts")
	transport, _ := kkrpc.NewStdioTransport(cmd)
	client := kkrpc.NewClient(transport)

	result, _ := client.Call("math.add", []any{1, 2})
	fmt.Println(result)
}
```

### WebSocket client

```go
package main

import (
	"fmt"

	"kkrpc-interop/kkrpc"
)

func main() {
	transport, _ := kkrpc.NewWebSocketTransport("ws://localhost:8789")
	client := kkrpc.NewClient(transport)

	result, _ := client.Call("echo", []any{map[string]any{"hello": "kkrpc"}})
	fmt.Println(result)
}
```

### Server

```go
package main

import (
	"kkrpc-interop/kkrpc"
)

func main() {
	api := kkrpc.NewApi()
	api.Register("math.add", func(args []any) any {
		return args[0].(float64) + args[1].(float64)
	})

	server := kkrpc.NewServer(kkrpc.NewStdioTransportFromStdIO(), api)
	server.ServeForever()
}
```

## Tests

```bash
cd interop/go

go test ./...
```

## How it works with kkrpc

- **Message format**: compact JSON records with `t`, `id`, `op`, `p`, `a`, and `v` fields.
- **Line-delimited transport**: each JSON message ends with `\n`.
- **Callbacks**: function arguments are encoded as `{ "__kkrpc_next_arg__": "callback", "id": "..." }` and dispatched with `t = "cb"`.
- **Adapters**: `Transport` is the common interface for `StdioTransport` and
  `WebSocketTransport`.

kkrpc JS clients/servers use the stable compact JSON `RPCMessage` protocol by default.

## Limitations

### Function Signatures

The Go server implementation uses a strict function signature: `func(...any) any`. All registered methods must conform to this signature:

```go
// Valid
api.Register("math.add", func(args ...any) any {
    return args[0].(float64) + args[1].(float64)
})

// Invalid - will fail at runtime
api.Register("math.add", func(a, b int) int {
    return a + b
})
```

This differs from the TypeScript implementation which can handle any callable. If you need more flexible signatures, consider using reflection or wrapper functions.
