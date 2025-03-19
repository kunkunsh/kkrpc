# kkrpc-go

A Go implementation of the kkrpc protocol, enabling bidirectional RPC communication between processes.

## Overview

kkrpc-go provides a Go implementation of the kkrpc protocol, allowing seamless communication between Go and other language implementations (TypeScript, Python, Rust, etc.) using the same message format and communication patterns.

## Core Components

### IoInterface

The `IoInterface` interface defines the communication channels for reading and writing data:

```go
type IoInterface interface {
    Name() string
    Read() ([]byte, error)
    Write(data string) error
}
```

Implementations include:
- `StdioInterface`: For communication over standard input/output
- Custom IO interfaces can be created for other channels

### RPCChannel

The main channel that handles the bidirectional communication:

```go
type RPCChannel struct {
    // Implementation details
}

func NewRPCChannel(io IoInterface, expose map[string]interface{}) *RPCChannel
func (c *RPCChannel) Expose(api map[string]interface{})
func (c *RPCChannel) CallMethod(method string, args ...interface{}) (interface{}, error)
func (c *RPCChannel) GetAPI() *RPCProxy
```

### RPCProxy

A proxy mechanism for making method calls with a more natural API:

```go
type RPCProxy struct {
    channel *RPCChannel
    path    []string
}

func (p *RPCProxy) Method(name string) *RPCProxy
func (p *RPCProxy) Call(ctx context.Context, args ...interface{}) (interface{}, error)
```

## Using the Library

### Basic Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    
    "github.com/kunkunsh/kkrpc/packages/kkrpc-go"
)

func main() {
    // Create an IO interface
    io := kkrpc.NewStdioInterface()
    
    // API that we'll expose to remote calls
    api := map[string]interface{}{
        "math": map[string]interface{}{
            "add":      "function",
            "subtract": "function",
        },
        "echo": "function",
    }
    
    // Create an RPC channel
    rpc := kkrpc.NewRPCChannel(io, api)
    
    // Get a proxy to the remote API
    remoteAPI := rpc.GetAPI()
    
    // Call a remote method
    ctx := context.Background()
    result, err := remoteAPI.Method("echo").Call(ctx, "Hello from Go!")
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error: %v\n", err)
    } else {
        fmt.Printf("Result: %v\n", result)
    }
}
```

### Communicating with Python

```go
package main

import (
    "bufio"
    "context"
    "fmt"
    "os"
    "os/exec"
    
    "github.com/kunkunsh/kkrpc/packages/kkrpc-go"
)

// ChildProcessIO implements IoInterface for child process communication
type ChildProcessIO struct {
    cmd    *exec.Cmd
    stdin  io.WriteCloser
    stdout *bufio.Reader
    mu     sync.Mutex
}

func NewChildProcessIO(cmd *exec.Cmd) (*ChildProcessIO, error) {
    stdin, err := cmd.StdinPipe()
    if err != nil {
        return nil, err
    }
    
    stdout, err := cmd.StdoutPipe()
    if err != nil {
        return nil, err
    }
    
    return &ChildProcessIO{
        cmd:    cmd,
        stdin:  stdin,
        stdout: bufio.NewReader(stdout),
    }, nil
}

func (c *ChildProcessIO) Name() string {
    return "child_process"
}

func (c *ChildProcessIO) Read() ([]byte, error) {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.stdout.ReadBytes('\n')
}

func (c *ChildProcessIO) Write(data string) error {
    c.mu.Lock()
    defer c.mu.Unlock()
    _, err := fmt.Fprint(c.stdin, data)
    return err
}

func main() {
    // Start a Python process
    cmd := exec.Command("python", "your_python_script.py")
    io, err := NewChildProcessIO(cmd)
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error creating IO: %v\n", err)
        return
    }
    
    if err := cmd.Start(); err != nil {
        fmt.Fprintf(os.Stderr, "Error starting process: %v\n", err)
        return
    }
    
    // Create RPC channel
    rpc := kkrpc.NewRPCChannel(io, nil)
    api := rpc.GetAPI()
    
    // Call a method in the Python process
    ctx := context.Background()
    result, err := api.Method("add").Call(ctx, 1, 2)
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error: %v\n", err)
    } else {
        fmt.Printf("1 + 2 = %v\n", result)
    }
    
    cmd.Process.Kill()
}
```

## Benefits of the Go Implementation

1. **Concurrency**: Leverages Go's goroutines for efficient concurrent operations
2. **Simplicity**: Clean API that follows Go idioms
3. **Performance**: High-performance implementation with low memory footprint
4. **Cross-language Communication**: Compatible with other kkrpc implementations
5. **Type Conversion**: Automatic conversion between Go and JSON types

## Proxy Pattern in Go

Unlike JavaScript's dynamic Proxy API, the Go implementation uses a more explicit method chaining approach:

```go
// JavaScript style in TypeScript
const result = await api.math.add(1, 2);

// Go equivalent
result, err := api.Method("math").Method("add").Call(ctx, 1, 2)
```

While not as seamless as JavaScript's proxy, this approach provides a reasonably clean API while maintaining Go's idioms and static typing.

## Roadmap

Future improvements:
- Code generation from API definitions
- More IO implementations (HTTP, WebSockets, etc.)
- Type-safe callback handling
- Better error handling and context support 