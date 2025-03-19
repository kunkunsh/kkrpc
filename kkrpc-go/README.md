# kkrpc-go

> A Go implementation of the kkrpc protocol, enabling seamless bi-directional communication between Go and JavaScript/TypeScript processes.

This is a Go implementation of the [kkrpc](https://github.com/kunkunsh/kkrpc) protocol, which allows for RPC-style communication between different processes. The original implementation is in TypeScript, and this Go port allows Go programs to communicate with JavaScript/TypeScript programs.

## Features

- Bidirectional RPC between Go and JavaScript/TypeScript
- Support for callbacks
- JSON serialization
- Flexible IO interfaces for different communication channels (stdio, etc.)
- Type-safe API proxies using Go reflection

## Architecture

kkrpc-go follows the same architecture as the original kkrpc:

- `IoInterface`: Interface for bidirectional communication channels
- `RPCChannel`: Handles message routing and function calls
- Serialization: JSON message serialization/deserialization
- Proxy: Type-safe API proxy generation using reflection (equivalent to JS Proxy)

## Usage

### Go Server for JavaScript Client

```go
package main

import (
	"fmt"

	"github.com/kunkunsh/kkrpc-go/channel"
	"github.com/kunkunsh/kkrpc-go/io"
)

// API implementation
type APIImpl struct{}

func (a *APIImpl) Add(x, y int) int {
	fmt.Printf("Add called with %d, %d\n", x, y)
	return x + y
}

func (a *APIImpl) Echo(msg string) string {
	fmt.Printf("Echo called with %s\n", msg)
	return msg
}

func main() {
	// Create a stdio interface
	stdio := io.NewGoStdio()
	
	// Create API implementation
	apiImpl := &APIImpl{}
	
	// Create RPC channel and expose the API
	_ = channel.NewRPCChannel(stdio, channel.WithAPI(apiImpl))
	
	// Block forever
	select {}
}
```

### Go Client for JavaScript Server

```go
package main

import (
	"fmt"
	"log"
	"os/exec"

	"github.com/kunkunsh/kkrpc-go/channel"
	"github.com/kunkunsh/kkrpc-go/io"
	"github.com/kunkunsh/kkrpc-go/proxy"
)

// Define the API structure that matches the JavaScript API
type JsAPI struct {
	Add func(a, b int) (int, error)
	Echo func(msg string) (string, error)
}

func main() {
	// Start a Node.js process
	cmd := exec.Command("node", "server.js")
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	
	// Create custom IO for Node.js process
	customIO := &io.CustomIO{
		Name_: "node-io",
		ReadFn: func() ([]byte, error) {
			buf := make([]byte, 1024)
			n, err := stdout.Read(buf)
			if err != nil {
				return nil, err
			}
			return buf[:n], nil
		},
		WriteFn: func(data string) error {
			_, err := stdin.Write([]byte(data))
			return err
		},
	}
	
	// Start the process
	cmd.Start()
	
	// Create RPC channel
	rpc := channel.NewRPCChannel(customIO)
	
	// Create a proxy API
	api := proxy.NewAPI(rpc)
	
	// Create the JavaScript API proxy
	jsAPI := &JsAPI{}
	api.GenerateProxy(jsAPI)
	
	// Call the Add method
	result, err := jsAPI.Add(5, 3)
	if err != nil {
		log.Fatalf("Failed to call Add: %v", err)
	}
	fmt.Printf("5 + 3 = %d\n", result)
}
```

## Difference from the TypeScript Implementation

The main difference is in the proxy implementation. JavaScript's Proxy object allows for a dynamic proxy that can handle any property access or method call. In Go, we use reflection to create a type-safe proxy based on a struct definition.

When using the Go implementation, you need to define a struct with fields that match the method names you want to call on the remote API. The proxy generator then sets up these fields with functions that, when called, will make the remote RPC call.

## Examples

Check the `examples` directory for complete examples:

- `examples/server`: Go server that exposes an API to JavaScript clients
- `examples/client`: Go client that calls a JavaScript API
- `examples/js`: JavaScript server for testing the Go client

## Running the Examples

### Running the Go Server

```bash
cd examples/server
go run main.go
```

### Running the JavaScript Client (from another terminal)

```bash
node js/client.js
```

### Running the JavaScript Server

```bash
cd examples/js
node server.js
```

### Running the Go Client (from another terminal)

```bash
cd examples/client
go run main.go
``` 