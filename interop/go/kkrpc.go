package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"strings"
	"sync"
	"time"
)

const callbackPrefix = "__callback__"

type Callback func(args ...any)

type rpcError struct {
	Name    string
	Message string
	Data    any
}

func (e *rpcError) Error() string {
	if e.Name == "" {
		return e.Message
	}
	return fmt.Sprintf("%s: %s", e.Name, e.Message)
}

type responsePayload struct {
	Result any
	Err    error
}

type Client struct {
	reader    *bufio.Reader
	writer    *bufio.Writer
	pending   map[string]chan responsePayload
	callbacks map[string]Callback
	mu        sync.Mutex
}

func NewClient(reader *bufio.Reader, writer *bufio.Writer) *Client {
	client := &Client{
		reader:    reader,
		writer:    writer,
		pending:   make(map[string]chan responsePayload),
		callbacks: make(map[string]Callback),
	}
	go client.readLoop()
	return client
}

func (c *Client) Call(method string, args ...any) (any, error) {
	requestID := generateUUID()
	responseCh := make(chan responsePayload, 1)
	c.mu.Lock()
	c.pending[requestID] = responseCh
	c.mu.Unlock()

	processedArgs := make([]any, 0, len(args))
	callbackIDs := make([]string, 0)
	for _, arg := range args {
		if cb, ok := arg.(Callback); ok {
			callbackID := generateUUID()
			c.mu.Lock()
			c.callbacks[callbackID] = cb
			c.mu.Unlock()
			callbackIDs = append(callbackIDs, callbackID)
			processedArgs = append(processedArgs, callbackPrefix+callbackID)
			continue
		}
		processedArgs = append(processedArgs, arg)
	}

	payload := map[string]any{
		"id":      requestID,
		"method":  method,
		"args":    processedArgs,
		"type":    "request",
		"version": "json",
	}
	if len(callbackIDs) > 0 {
		payload["callbackIds"] = callbackIDs
	}

	if err := c.writeMessage(payload); err != nil {
		return nil, err
	}

	response := <-responseCh
	return response.Result, response.Err
}

func (c *Client) writeMessage(payload map[string]any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := c.writer.WriteString(string(data) + "\n"); err != nil {
		return err
	}
	return c.writer.Flush()
}

func (c *Client) readLoop() {
	for {
		line, err := c.reader.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var message map[string]any
		if err := json.Unmarshal([]byte(line), &message); err != nil {
			continue
		}
		messageType, _ := message["type"].(string)
		switch messageType {
		case "response":
			c.handleResponse(message)
		case "callback":
			c.handleCallback(message)
		}
	}
}

func (c *Client) handleResponse(message map[string]any) {
	requestID, _ := message["id"].(string)
	c.mu.Lock()
	responseCh, ok := c.pending[requestID]
	if ok {
		delete(c.pending, requestID)
	}
	c.mu.Unlock()
	if !ok {
		return
	}

	args, _ := message["args"].(map[string]any)
	if args == nil {
		responseCh <- responsePayload{Result: nil}
		return
	}
	if errValue, exists := args["error"]; exists {
		responseCh <- responsePayload{Result: nil, Err: decodeError(errValue)}
		return
	}
	responseCh <- responsePayload{Result: args["result"], Err: nil}
}

func (c *Client) handleCallback(message map[string]any) {
	callbackID, _ := message["method"].(string)
	c.mu.Lock()
	callback := c.callbacks[callbackID]
	c.mu.Unlock()
	if callback == nil {
		return
	}

	argsRaw, _ := message["args"].([]any)
	if argsRaw == nil {
		callback()
		return
	}
	callback(argsRaw...)
}

func decodeError(value any) error {
	if value == nil {
		return errors.New("unknown error")
	}
	if errMap, ok := value.(map[string]any); ok {
		name, _ := errMap["name"].(string)
		message, _ := errMap["message"].(string)
		return &rpcError{Name: name, Message: message, Data: errMap}
	}
	return fmt.Errorf("%v", value)
}

func generateUUID() string {
	parts := make([]string, 0, 4)
	for i := 0; i < 4; i++ {
		parts = append(parts, fmt.Sprintf("%x", rand.Int63()))
	}
	return strings.Join(parts, "-")
}

func init() {
	rand.Seed(time.Now().UnixNano())
}

func newStdioClient() *Client {
	return NewClient(bufio.NewReader(os.Stdin), bufio.NewWriter(os.Stdout))
}
