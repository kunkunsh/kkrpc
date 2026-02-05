# kkrpc - GO INTEROP

**Generated:** 2026-02-05
**Location:** interop/go

## OVERVIEW

Go client/server library for kkrpc JSON-mode interop. Enables cross-language RPC between Go and TypeScript/JavaScript using JSON-only protocol.

## STRUCTURE

```
go/
├── kkrpc/
│   ├── client.go          # RPC client implementation
│   ├── server.go          # RPC server implementation
│   ├── protocol.go        # Message encoding/decoding, UUID generation
│   ├── transport.go       # Transport interface
│   ├── stdio.go           # StdioTransport implementation
│   ├── websocket.go       # WebSocketTransport implementation
│   ├── stdio_test.go      # Stdio transport tests
│   ├── ws_test.go         # WebSocket tests
│   └── test_helpers.go    # Test utilities
├── go.mod                 # Go module definition
└── README.md              # Usage documentation
```

## KEY FILES

| File           | Purpose                                     |
| -------------- | ------------------------------------------- |
| `client.go`    | RpcClient with Call(), Get(), Set() methods |
| `server.go`    | RpcServer with request dispatch             |
| `protocol.go`  | UUID generation, JSON encode/decode         |
| `transport.go` | Transport interface (Read/Write/Close)      |
| `stdio.go`     | StdioTransport for process communication    |
| `websocket.go` | WebSocketTransport for WS connections       |

## IMPLEMENTATION PATTERNS

### Transport Interface

```go
type Transport interface {
    Read() (string, error)
    Write(message string) error
    Close() error
}
```

### Client Usage

```go
transport, _ := kkrpc.NewStdioTransport(cmd)
client := kkrpc.NewClient(transport)
result, _ := client.Call("math.add", []any{1, 2})
```

### Server Usage

```go
api := kkrpc.NewApi()
api.Register("math.add", func(args []any) any {
    return args[0].(float64) + args[1].(float64)
})
server := kkrpc.NewServer(kkrpc.NewStdioTransportFromStdIO(), api)
server.ServeForever()
```

## CONVENTIONS

- **Function signatures**: Server handlers use `func([]any) any` signature
- **Error handling**: Explicit error returns (Go idiomatic)
- **Concurrency**: Goroutines for read loops, mutex for state
- **JSON only**: Compatible with kkrpc `serialization.version = "json"`

## COMMANDS

```bash
# Run tests
go test ./...

# Build example
go build -o myapp
```

## NOTES

- Go 1.21+ required
- No external dependencies (stdlib only)
- Callbacks encoded as `__callback__<id>` strings
- Line-delimited JSON protocol (`\n` terminated)

## LIMITATIONS

Server handlers must use strict signature:

```go
// Valid
api.Register("math.add", func(args []any) any { ... })

// Invalid - will fail at runtime
api.Register("math.add", func(a, b int) int { ... })
```
