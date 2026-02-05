package kkrpc

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestStdioClient(t *testing.T) {
	root, err := os.Getwd()
	if err != nil {
		t.Fatalf("cwd: %v", err)
	}
	serverPath := filepath.Join(root, "..", "..", "node", "server.ts")

	cmd := exec.Command("bun", serverPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatalf("stdin: %v", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout: %v", err)
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	transport := NewStdioTransport(stdout, stdin)
	client := NewClient(transport)

	result, err := client.Call("math.add", 4, 7)
	if err != nil {
		t.Fatalf("math.add: %v", err)
	}
	if number, ok := result.(float64); !ok || number != 11 {
		t.Fatalf("unexpected add result: %#v", result)
	}

	echoInput := map[string]any{"name": "kkrpc", "count": 2}
	echoResult, err := client.Call("echo", echoInput)
	if err != nil {
		t.Fatalf("echo: %v", err)
	}
	if !compareMaps(echoInput, echoResult) {
		t.Fatalf("unexpected echo result: %#v", echoResult)
	}

	callbackCh := make(chan string, 1)
	callback := Callback(func(args ...any) {
		if len(args) > 0 {
			callbackCh <- toString(args[0])
		}
	})

	callbackResult, err := client.Call("withCallback", "pong", callback)
	if err != nil {
		t.Fatalf("withCallback: %v", err)
	}
	if callbackResult != "callback-sent" {
		t.Fatalf("unexpected callback result: %#v", callbackResult)
	}

	select {
	case value := <-callbackCh:
		if value != "callback:pong" {
			t.Fatalf("unexpected callback payload: %s", value)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("callback not received")
	}

	_ = client.Close()
	_ = stdin.Close()
	_ = stdout.Close()
	_ = cmd.Process.Kill()
	_, _ = cmd.Process.Wait()
}
