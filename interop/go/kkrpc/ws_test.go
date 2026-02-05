package kkrpc

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestWebSocketClient(t *testing.T) {
	root, err := os.Getwd()
	if err != nil {
		t.Fatalf("cwd: %v", err)
	}
	serverPath := filepath.Join(root, "..", "..", "node", "ws-server.ts")

	cmd := exec.Command("bun", serverPath)
	cmd.Env = append(os.Environ(), "PORT=8790")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	// Give server time to boot
	time.Sleep(200 * time.Millisecond)

	transport, err := NewWebSocketTransport("ws://localhost:8790")
	if err != nil {
		t.Fatalf("ws transport: %v", err)
	}
	client := NewClient(transport)

	result, err := client.Call("math.add", 10, 11)
	if err != nil {
		t.Fatalf("math.add: %v", err)
	}
	if number, ok := result.(float64); !ok || number != 21 {
		t.Fatalf("unexpected add result: %#v", result)
	}

	echoInput := map[string]any{"name": "kkrpc", "count": 9}
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

	callbackResult, err := client.Call("withCallback", "ws", callback)
	if err != nil {
		t.Fatalf("withCallback: %v", err)
	}
	if callbackResult != "callback-sent" {
		t.Fatalf("unexpected callback result: %#v", callbackResult)
	}

	select {
	case value := <-callbackCh:
		if value != "callback:ws" {
			t.Fatalf("unexpected callback payload: %s", value)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("callback not received")
	}
}
