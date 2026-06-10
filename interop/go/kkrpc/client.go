package kkrpc

import (
	"errors"
	"strings"
	"sync"
)

type Callback func(args ...any)

type responsePayload struct {
	Result any
	Err    error
}

type Client struct {
	transport Transport
	pending   map[string]chan responsePayload
	callbacks map[string]Callback
	mu        sync.Mutex
}

func NewClient(transport Transport) *Client {
	client := &Client{
		transport: transport,
		pending:   make(map[string]chan responsePayload),
		callbacks: make(map[string]Callback),
	}
	go client.readLoop()
	return client
}

func (c *Client) Call(method string, args ...any) (any, error) {
	return c.sendRequest("call", strings.Split(method, "."), args, nil)
}

func (c *Client) Get(path []string) (any, error) {
	return c.sendRequest("get", path, nil, nil)
}

func (c *Client) Set(path []string, value any) (any, error) {
	return c.sendRequest("set", path, nil, value)
}

func (c *Client) sendRequest(op string, path []string, args []any, value any) (any, error) {
	requestID := GenerateUUID()
	responseCh := make(chan responsePayload, 1)
	c.mu.Lock()
	c.pending[requestID] = responseCh
	c.mu.Unlock()

	processedArgs := make([]any, 0, len(args))
	for _, arg := range args {
		if cb, ok := arg.(Callback); ok {
			callbackID := GenerateUUID()
			c.mu.Lock()
			c.callbacks[callbackID] = cb
			c.mu.Unlock()
			processedArgs = append(processedArgs, map[string]any{ArgEnvelopeTag: "callback", "id": callbackID})
			continue
		}
		processedArgs = append(processedArgs, arg)
	}

	payload := map[string]any{
		"t":  "q",
		"id": requestID,
		"op": op,
		"p":  path,
	}
	if len(processedArgs) > 0 {
		payload["a"] = processedArgs
	}
	if op == "set" || value != nil {
		payload["v"] = value
	}

	message, err := EncodeMessage(payload)
	if err != nil {
		return nil, err
	}
	if err := c.transport.Write(message); err != nil {
		return nil, err
	}

	response := <-responseCh
	return response.Result, response.Err
}

func (c *Client) Close() error {
	return c.transport.Close()
}

func (c *Client) readLoop() {
	for {
		line, err := c.transport.Read()
		if err != nil {
			if errors.Is(err, ErrTransportClosed) {
				return
			}
			return
		}
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		message, err := DecodeMessage(trimmed)
		if err != nil {
			continue
		}
		messageType, _ := message["t"].(string)
		switch messageType {
		case "r":
			c.handleResponse(message)
		case "cb":
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

	if errValue, exists := message["e"]; exists {
		responseCh <- responsePayload{Result: nil, Err: decodeError(errValue)}
		return
	}
	responseCh <- responsePayload{Result: message["v"], Err: nil}
}

func (c *Client) handleCallback(message map[string]any) {
	callbackID, _ := message["id"].(string)
	c.mu.Lock()
	callback := c.callbacks[callbackID]
	c.mu.Unlock()
	if callback == nil {
		return
	}

	argsRaw, _ := message["a"].([]any)
	if argsRaw == nil {
		callback()
		return
	}
	callback(decodeArgs(argsRaw)...)
}

func decodeArgs(args []any) []any {
	decoded := make([]any, 0, len(args))
	for _, arg := range args {
		decoded = append(decoded, decodeArg(arg))
	}
	return decoded
}

func decodeArg(arg any) any {
	envelope, ok := arg.(map[string]any)
	if !ok || envelope[ArgEnvelopeTag] != "value" {
		return arg
	}
	return envelope["v"]
}

type RpcError struct {
	Name    string
	Message string
	Data    any
}

func (e *RpcError) Error() string {
	if e.Name == "" {
		return e.Message
	}
	return e.Name + ": " + e.Message
}

func decodeError(value any) error {
	if value == nil {
		return errors.New("unknown error")
	}
	if errMap, ok := value.(map[string]any); ok {
		name, _ := errMap["n"].(string)
		message, _ := errMap["m"].(string)
		return &RpcError{Name: name, Message: message, Data: errMap}
	}
	return errors.New("rpc error")
}
