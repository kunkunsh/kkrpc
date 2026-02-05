package kkrpc

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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
	cmd.Env = append(os.Environ(), "PORT=0")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout: %v", err)
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	scanner := bufio.NewScanner(stdout)
	port := ""
	re := regexp.MustCompile(`listening on (\d+)`)
	for scanner.Scan() {
		line := scanner.Text()
		matches := re.FindStringSubmatch(line)
		if len(matches) > 1 {
			port = matches[1]
			break
		}
	}
	if port == "" {
		t.Fatalf("failed to get server port")
	}

	time.Sleep(100 * time.Millisecond)

	transport, err := NewWebSocketTransport("ws://localhost:" + port)
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

func TestWebSocketPropertyAccess(t *testing.T) {
	root, err := os.Getwd()
	if err != nil {
		t.Fatalf("cwd: %v", err)
	}
	serverPath := filepath.Join(root, "..", "..", "node", "ws-server.ts")

	cmd := exec.Command("bun", serverPath)
	cmd.Env = append(os.Environ(), "PORT=0")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout: %v", err)
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	scanner := bufio.NewScanner(stdout)
	port := ""
	re := regexp.MustCompile(`listening on (\d+)`)
	for scanner.Scan() {
		line := scanner.Text()
		matches := re.FindStringSubmatch(line)
		if len(matches) > 1 {
			port = matches[1]
			break
		}
	}
	if port == "" {
		t.Fatalf("failed to get server port")
	}

	time.Sleep(100 * time.Millisecond)

	transport, err := NewWebSocketTransport("ws://localhost:" + port)
	if err != nil {
		t.Fatalf("ws transport: %v", err)
	}
	client := NewClient(transport)

	counter, err := client.Get([]string{"counter"})
	if err != nil {
		t.Fatalf("get counter: %v", err)
	}
	if number, ok := counter.(float64); !ok || number != 42 {
		t.Fatalf("unexpected counter value: %#v", counter)
	}

	theme, err := client.Get([]string{"settings", "theme"})
	if err != nil {
		t.Fatalf("get theme: %v", err)
	}
	if theme != "light" {
		t.Fatalf("unexpected theme: %#v", theme)
	}

	notificationsEnabled, err := client.Get([]string{"settings", "notifications", "enabled"})
	if err != nil {
		t.Fatalf("get notifications.enabled: %v", err)
	}
	if enabled, ok := notificationsEnabled.(bool); !ok || !enabled {
		t.Fatalf("unexpected notifications.enabled: %#v", notificationsEnabled)
	}

	_, err = client.Set([]string{"settings", "theme"}, "dark")
	if err != nil {
		t.Fatalf("set theme: %v", err)
	}

	newTheme, err := client.Get([]string{"settings", "theme"})
	if err != nil {
		t.Fatalf("get new theme: %v", err)
	}
	if newTheme != "dark" {
		t.Fatalf("unexpected new theme: %#v", newTheme)
	}
}
