package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

func main() {
	root, err := os.Getwd()
	if err != nil {
		panic(err)
	}
	serverPath := filepath.Join(root, "interop", "node", "server.ts")

	cmd := exec.Command("bun", serverPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		panic(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		panic(err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		panic(err)
	}

	if err := cmd.Start(); err != nil {
		panic(err)
	}

	client := NewClient(bufio.NewReader(stdout), bufio.NewWriter(stdin))

	result, err := client.Call("math.add", 4, 7)
	if err != nil {
		panic(err)
	}
	if number, ok := result.(float64); !ok || number != 11 {
		panic(fmt.Sprintf("unexpected add result: %#v", result))
	}
	fmt.Printf("[go] math.add(4, 7) => %v\n", result)

	echoInput := map[string]any{"name": "kkrpc", "count": 2}
	echoResult, err := client.Call("echo", echoInput)
	if err != nil {
		panic(err)
	}
	if !compareMaps(echoInput, echoResult) {
		panic(fmt.Sprintf("unexpected echo result: %#v", echoResult))
	}
	fmt.Printf("[go] echo(%v) => %v\n", echoInput, echoResult)

	callbackCh := make(chan string, 1)
	callback := Callback(func(args ...any) {
		if len(args) > 0 {
			callbackCh <- fmt.Sprintf("%v", args[0])
		}
	})

	callbackResult, err := client.Call("withCallback", "pong", callback)
	if err != nil {
		panic(err)
	}
	if callbackResult != "callback-sent" {
		panic(fmt.Sprintf("unexpected callback result: %#v", callbackResult))
	}
	fmt.Printf("[go] withCallback(\"pong\", cb) => %v\n", callbackResult)

	select {
	case value := <-callbackCh:
		if value != "callback:pong" {
			panic(fmt.Sprintf("unexpected callback payload: %s", value))
		}
		fmt.Printf("[go] callback received => %s\n", value)
	case <-time.After(2 * time.Second):
		panic(errors.New("callback not received"))
	}

	_ = stdin.Close()
	_ = stdout.Close()
	_ = stderr.Close()

	_ = cmd.Process.Kill()
	_, _ = cmd.Process.Wait()
}

func compareMaps(expected map[string]any, actual any) bool {
	actualMap, ok := actual.(map[string]any)
	if !ok {
		return false
	}
	for key, value := range expected {
		actualValue, exists := actualMap[key]
		if !exists || !valuesEqual(value, actualValue) {
			return false
		}
	}
	return true
}

func valuesEqual(expected any, actual any) bool {
	if expectedNumber, ok := toFloat64(expected); ok {
		if actualNumber, ok := toFloat64(actual); ok {
			return expectedNumber == actualNumber
		}
	}
	return expected == actual
}

func toFloat64(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	default:
		return 0, false
	}
}
