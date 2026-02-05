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
	requestID := GenerateUUID()
	responseCh := make(chan responsePayload, 1)
	c.mu.Lock()
	c.pending[requestID] = responseCh
	c.mu.Unlock()

	processedArgs := make([]any, 0, len(args))
	callbackIDs := make([]string, 0)
	for _, arg := range args {
		if cb, ok := arg.(Callback); ok {
			callbackID := GenerateUUID()
			c.mu.Lock()
			c.callbacks[callbackID] = cb
			c.mu.Unlock()
			callbackIDs = append(callbackIDs, callbackID)
			processedArgs = append(processedArgs, CallbackPrefix+callbackID)
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
		name, _ := errMap["name"].(string)
		message, _ := errMap["message"].(string)
		return &RpcError{Name: name, Message: message, Data: errMap}
	}
	return errors.New("rpc error")
}
