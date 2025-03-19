package client

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"

	"github.com/kunkunsh/kkrpc-go/channel"
	"github.com/kunkunsh/kkrpc-go/io"
	"github.com/kunkunsh/kkrpc-go/proxy"
)

// Define the API structure that matches the JavaScript API
type JsAPI struct {
	// Method names with their function signatures
	Add          func(a, b int) (int, error)
	Echo         func(msg string) (string, error)
	GetData      func() (map[string]interface{}, error)
	WithCallback func(callback func(result string)) error
}

// RunClient runs the Go client example that calls a JavaScript API
func RunClient() {
	// Path to the Node.js script (adjust the path as needed)
	nodePath := "examples/js_server.js"

	// Create Node.js process
	cmd := exec.Command("node", nodePath)

	// Connect stdin and stdout
	stdin, err := cmd.StdinPipe()
	if err != nil {
		log.Fatalf("Failed to get stdin pipe: %v", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Fatalf("Failed to get stdout pipe: %v", err)
	}

	// Redirect stderr to console for debugging
	cmd.Stderr = os.Stderr

	// Create a custom IO wrapper for the Node.js process
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

	// Start the Node.js process
	if err := cmd.Start(); err != nil {
		log.Fatalf("Failed to start Node.js process: %v", err)
	}

	// Create RPC channel
	rpc := channel.NewRPCChannel(customIO)

	// Create a proxy API
	api := proxy.NewAPI(rpc)

	// Create the JavaScript API proxy
	jsAPI := &JsAPI{}
	if err := api.GenerateProxy(jsAPI); err != nil {
		log.Fatalf("Failed to generate proxy: %v", err)
	}

	// Example: Call the Add method
	result, err := jsAPI.Add(5, 3)
	if err != nil {
		log.Fatalf("Failed to call Add: %v", err)
	}
	fmt.Printf("5 + 3 = %d\n", result)

	// Example: Call the Echo method
	echo, err := jsAPI.Echo("Hello from Go!")
	if err != nil {
		log.Fatalf("Failed to call Echo: %v", err)
	}
	fmt.Printf("Echo: %s\n", echo)

	// Example: Call the GetData method
	data, err := jsAPI.GetData()
	if err != nil {
		log.Fatalf("Failed to call GetData: %v", err)
	}
	dataJSON, _ := json.MarshalIndent(data, "", "  ")
	fmt.Printf("Data: %s\n", dataJSON)

	// Example: Call with a callback
	err = jsAPI.WithCallback(func(result string) {
		fmt.Printf("Callback received: %s\n", result)
	})
	if err != nil {
		log.Fatalf("Failed to call WithCallback: %v", err)
	}

	// Wait for the Node.js process to exit
	if err := cmd.Wait(); err != nil {
		log.Fatalf("Node.js process exited with error: %v", err)
	}
}
