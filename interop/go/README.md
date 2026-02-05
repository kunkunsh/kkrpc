# kkrpc-interop (Go)

Go client/server library for kkrpc JSON-mode interop. This package mirrors the kkrpc
message protocol using JSON only, enabling cross-language RPC.

## Features

- JSON-mode request/response compatible with kkrpc `serialization.version = "json"`.
- `stdio` and `ws` transports with a shared `Transport` interface.
- Callback support using `__callback__<id>` tokens.

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

- **Message format**: JSON objects with `id`, `method`, `args`, `type`, `version`.
- **Line-delimited transport**: each JSON message ends with `\n`.
- **Callbacks**: function arguments are encoded as `__callback__<id>` and dispatched via
  `type = "callback"`.
- **Adapters**: `Transport` is the common interface for `StdioTransport` and
  `WebSocketTransport`.

Set kkrpc JS clients/servers to `serialization.version = "json"` for interop.
