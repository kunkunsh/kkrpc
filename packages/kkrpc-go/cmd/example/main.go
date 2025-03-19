package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/kunkunsh/kkrpc/packages/kkrpc-go/pkg/kkrpc"
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
	// Display a welcome message
	fmt.Println("kkrpc Go Example - Communicating with a Python RPC server")
	fmt.Println("=========================================================")

	// Start a Python process that will serve as a simple RPC server
	cmd := exec.Command("python3", "-c", `
import json
import sys

# Simple RPC server
def add(a, b):
    return a + b

def echo(message):
    return message

# API implementation
api = {
    "add": add,
    "echo": echo
}

# Process messages
print("Python RPC server started", file=sys.stderr)
while True:
    line = sys.stdin.readline()
    if not line:
        break
    try:
        message = json.loads(line)
        if message["type"] == "request":
            method = message["method"]
            args = message["args"]
            
            # Find the correct function
            func = api.get(method)
            if func:
                result = func(*args)
                response = {
                    "id": message["id"],
                    "method": "",
                    "args": {"result": result},
                    "type": "response"
                }
            else:
                response = {
                    "id": message["id"],
                    "method": "",
                    "args": {"error": f"Method {method} not found"},
                    "type": "response"
                }
            
            print(json.dumps(response), flush=True)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr, flush=True)
`)

	// Redirect stderr to our stderr for debugging
	cmd.Stderr = os.Stderr

	// Create IO interface for the child process
	io, err := NewChildProcessIO(cmd)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating IO: %v\n", err)
		return
	}

	// Start the Python process
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Error starting process: %v\n", err)
		return
	}

	// Make sure we kill the process when we're done
	defer cmd.Process.Kill()

	// Create RPC channel
	rpc := kkrpc.NewRPCChannel(io, nil)

	// Get the remote API proxy
	api := rpc.GetAPI()

	// Wait a moment for the Python process to initialize
	time.Sleep(500 * time.Millisecond)

	// Call the echo method
	fmt.Println("\nCalling remote echo method...")
	echoResult, err := api.Method("echo").Call("Hello from Go!")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error calling echo: %v\n", err)
	} else {
		fmt.Printf("Echo result: %v\n", echoResult)
	}

	// Call the add method
	fmt.Println("\nCalling remote add method...")
	addResult, err := api.Method("add").Call(5, 7)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error calling add: %v\n", err)
	} else {
		fmt.Printf("5 + 7 = %v\n", addResult)
	}

	fmt.Println("\nRPC calls completed successfully!")

	// Wait a moment to ensure all responses are processed
	time.Sleep(100 * time.Millisecond)
}
