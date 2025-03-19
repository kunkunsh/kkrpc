package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/google/uuid"
)

// MessageType represents the type of message being sent
type MessageType string

const (
	Request  MessageType = "request"
	Response MessageType = "response"
	Callback MessageType = "callback"
)

// Message represents a message in the RPC protocol
type Message struct {
	ID          string      `json:"id"`
	Method      string      `json:"method"`
	Args        interface{} `json:"args"`
	Type        MessageType `json:"type"`
	CallbackIDs []string    `json:"callbackIds,omitempty"`
	Version     string      `json:"version,omitempty"`
}

// ResponsePayload represents the payload of a response message
type ResponsePayload struct {
	Result interface{} `json:"result,omitempty"`
	Error  string      `json:"error,omitempty"`
}

// IoInterface defines the interface for communication channels
type IoInterface interface {
	Name() string
	Read() ([]byte, error)
	Write(data string) error
}

// StdioInterface implements IoInterface using standard input/output
type StdioInterface struct {
	reader *bufio.Reader
	writer io.Writer
	mu     sync.Mutex
}

// NewStdioInterface creates a new StdioInterface
func NewStdioInterface() *StdioInterface {
	return &StdioInterface{
		reader: bufio.NewReader(os.Stdin),
		writer: os.Stdout,
	}
}

// Name returns the name of the interface
func (s *StdioInterface) Name() string {
	return "stdio"
}

// Read reads a line from stdin
func (s *StdioInterface) Read() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.reader.ReadBytes('\n')
}

// Write writes data to stdout
func (s *StdioInterface) Write(data string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := fmt.Fprint(s.writer, data)
	return err
}

// PendingRequest represents a pending request waiting for a response
type PendingRequest struct {
	resultCh chan interface{}
	errorCh  chan string
}

// CallbackFunc is a function that can be called remotely
type CallbackFunc func(args ...interface{})

// RPCChannel represents a bidirectional RPC channel
type RPCChannel struct {
	io                IoInterface
	apiImplementation map[string]interface{}
	pendingRequests   map[string]*PendingRequest
	callbacks         map[string]CallbackFunc
	callbackRegistry  map[string]string // Maps callback pointer address to ID
	messageBuffer     string
	mu                sync.RWMutex
	callbackMu        sync.RWMutex
}

// NewRPCChannel creates a new RPCChannel
func NewRPCChannel(io IoInterface, expose map[string]interface{}) *RPCChannel {
	if expose == nil {
		expose = make(map[string]interface{})
	}

	channel := &RPCChannel{
		io:                io,
		apiImplementation: expose,
		pendingRequests:   make(map[string]*PendingRequest),
		callbacks:         make(map[string]CallbackFunc),
		callbackRegistry:  make(map[string]string),
		messageBuffer:     "",
	}

	go channel.listen()
	return channel
}

// Expose sets the API implementation
func (c *RPCChannel) Expose(api map[string]interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.apiImplementation = api
}

// listen continuously listens for incoming messages
func (c *RPCChannel) listen() {
	for {
		buffer, err := c.io.Read()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			fmt.Fprintf(os.Stderr, "Error reading: %v\n", err)
			continue
		}

		bufferStr := string(buffer)
		if strings.TrimSpace(bufferStr) == "" {
			continue
		}

		c.mu.Lock()
		c.messageBuffer += bufferStr
		lastChar := ""
		if len(c.messageBuffer) > 0 {
			lastChar = c.messageBuffer[len(c.messageBuffer)-1:]
		}

		msgsSplit := strings.Split(c.messageBuffer, "\n")
		var msgs []string
		if lastChar == "\n" {
			msgs = msgsSplit
		} else {
			msgs = msgsSplit[:len(msgsSplit)-1]
		}

		if lastChar == "\n" {
			c.messageBuffer = ""
		} else {
			c.messageBuffer = msgsSplit[len(msgsSplit)-1]
		}
		c.mu.Unlock()

		for _, msgStr := range msgs {
			msgStr = strings.TrimSpace(msgStr)
			if msgStr == "" {
				continue
			}

			if strings.HasPrefix(msgStr, "{") {
				c.handleMessageStr(msgStr)
			} else {
				fmt.Printf("(kkrpc stdout passthrough): %s\n", msgStr)
			}
		}
	}
}

// handleMessageStr handles a single message string
func (c *RPCChannel) handleMessageStr(messageStr string) {
	var message Message
	if err := json.Unmarshal([]byte(messageStr), &message); err != nil {
		fmt.Fprintf(os.Stderr, "Error deserializing message: %v\n", err)
		return
	}

	switch message.Type {
	case Response:
		c.handleResponse(message)
	case Request:
		c.handleRequest(message)
	case Callback:
		c.handleCallback(message)
	default:
		fmt.Fprintf(os.Stderr, "Unknown message type: %s\n", message.Type)
	}
}

// getCallbackID gets or creates a unique ID for a callback function
func (c *RPCChannel) getCallbackID(callback CallbackFunc) string {
	c.callbackMu.Lock()
	defer c.callbackMu.Unlock()

	// Convert the callback function to a unique string representation
	callbackAddr := fmt.Sprintf("%p", callback)

	// Check if we already have an ID for this callback
	if id, exists := c.callbackRegistry[callbackAddr]; exists {
		return id
	}

	// Create a new ID
	id := uuid.New().String()
	c.callbacks[id] = callback
	c.callbackRegistry[callbackAddr] = id

	return id
}

// CallMethod calls a method on the remote API
func (c *RPCChannel) CallMethod(method string, args ...interface{}) (interface{}, error) {
	requestID := uuid.New().String()

	// Process arguments for callbacks
	callbackIDs := []string{}
	processedArgs := make([]interface{}, len(args))

	for i, arg := range args {
		if callback, ok := arg.(func(...interface{})); ok {
			callbackID := c.getCallbackID(callback)
			callbackIDs = append(callbackIDs, callbackID)
			processedArgs[i] = fmt.Sprintf("__callback__%s", callbackID)
		} else {
			processedArgs[i] = arg
		}
	}

	// Create message
	message := Message{
		ID:      requestID,
		Method:  method,
		Args:    processedArgs,
		Type:    Request,
		Version: "json",
	}

	if len(callbackIDs) > 0 {
		message.CallbackIDs = callbackIDs
	}

	// Create channels for the response
	resultCh := make(chan interface{}, 1)
	errorCh := make(chan string, 1)

	c.mu.Lock()
	c.pendingRequests[requestID] = &PendingRequest{
		resultCh: resultCh,
		errorCh:  errorCh,
	}
	c.mu.Unlock()

	// Send the message
	messageJSON, err := json.Marshal(message)
	if err != nil {
		return nil, fmt.Errorf("error serializing message: %w", err)
	}

	if err := c.io.Write(string(messageJSON) + "\n"); err != nil {
		return nil, fmt.Errorf("error sending message: %w", err)
	}

	// Wait for the response
	select {
	case result := <-resultCh:
		return result, nil
	case errMsg := <-errorCh:
		return nil, errors.New(errMsg)
	}
}

// handleResponse handles a response message
func (c *RPCChannel) handleResponse(message Message) {
	c.mu.Lock()
	pendingRequest, exists := c.pendingRequests[message.ID]
	if exists {
		delete(c.pendingRequests, message.ID)
	}
	c.mu.Unlock()

	if !exists {
		return
	}

	// Extract the result or error
	if responseMap, ok := message.Args.(map[string]interface{}); ok {
		if errMsg, hasError := responseMap["error"]; hasError && errMsg != nil {
			pendingRequest.errorCh <- fmt.Sprintf("%v", errMsg)
			return
		}

		if result, hasResult := responseMap["result"]; hasResult {
			pendingRequest.resultCh <- result
			return
		}
	}

	// If we can't extract properly, just return the args
	pendingRequest.resultCh <- message.Args
}

// handleRequest handles a request message
func (c *RPCChannel) handleRequest(message Message) {
	// Parse the method path
	methodPath := strings.Split(message.Method, ".")

	c.mu.RLock()
	target := c.apiImplementation
	c.mu.RUnlock()

	// Traverse the method path
	for i := 0; i < len(methodPath)-1; i++ {
		component := methodPath[i]
		if nestedObj, ok := target[component].(map[string]interface{}); ok {
			target = nestedObj
		} else {
			errMsg := fmt.Sprintf("Method path %s not found at %s", message.Method, component)
			c.sendError(message.ID, errMsg)
			return
		}
	}

	// Get the final method
	finalMethod := methodPath[len(methodPath)-1]
	_, ok := target[finalMethod]
	if !ok {
		errMsg := fmt.Sprintf("Method %s not found", message.Method)
		c.sendError(message.ID, errMsg)
		return
	}

	// This is a simplified version - in a real implementation, you'd use reflection
	// to call the actual function with the arguments
	// For now, just simulate a response
	result := fmt.Sprintf("Called %s with %v", message.Method, message.Args)
	c.sendResponse(message.ID, result)
}

// handleCallback handles a callback message
func (c *RPCChannel) handleCallback(message Message) {
	c.callbackMu.RLock()
	callback, exists := c.callbacks[message.Method]
	c.callbackMu.RUnlock()

	if !exists {
		fmt.Fprintf(os.Stderr, "Callback with id %s not found\n", message.Method)
		return
	}

	// Convert args to a slice if it's not already
	var args []interface{}
	if argsSlice, ok := message.Args.([]interface{}); ok {
		args = argsSlice
	} else {
		args = []interface{}{message.Args}
	}

	callback(args...)
}

// sendResponse sends a successful response
func (c *RPCChannel) sendResponse(requestID string, result interface{}) {
	response := Message{
		ID:     requestID,
		Method: "",
		Args: ResponsePayload{
			Result: result,
		},
		Type:    Response,
		Version: "json",
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error serializing response: %v\n", err)
		return
	}

	if err := c.io.Write(string(responseJSON) + "\n"); err != nil {
		fmt.Fprintf(os.Stderr, "Error sending response: %v\n", err)
	}
}

// sendError sends an error response
func (c *RPCChannel) sendError(requestID string, errorMessage string) {
	response := Message{
		ID:     requestID,
		Method: "",
		Args: ResponsePayload{
			Error: errorMessage,
		},
		Type:    Response,
		Version: "json",
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error serializing error response: %v\n", err)
		return
	}

	if err := c.io.Write(string(responseJSON) + "\n"); err != nil {
		fmt.Fprintf(os.Stderr, "Error sending error response: %v\n", err)
	}
}

// RPCProxy provides a proxy for remote API calls
type RPCProxy struct {
	channel *RPCChannel
	path    []string
}

// NewRPCProxy creates a new RPCProxy
func NewRPCProxy(channel *RPCChannel) *RPCProxy {
	return &RPCProxy{
		channel: channel,
		path:    []string{},
	}
}

// Method adds a method to the call path
func (p *RPCProxy) Method(name string) *RPCProxy {
	newPath := append([]string{}, p.path...)
	newPath = append(newPath, name)

	return &RPCProxy{
		channel: p.channel,
		path:    newPath,
	}
}

// Call calls the method with the given arguments
func (p *RPCProxy) Call(ctx context.Context, args ...interface{}) (interface{}, error) {
	method := strings.Join(p.path, ".")
	return p.channel.CallMethod(method, args...)
}

// GetAPI returns a proxy for the remote API
func (c *RPCChannel) GetAPI() *RPCProxy {
	return NewRPCProxy(c)
}

func main() {
	// Create IO interface
	io := NewStdioInterface()

	// API that we'll expose to remote calls
	api := map[string]interface{}{
		"math": map[string]interface{}{
			"add":      "function",
			"subtract": "function",
		},
		"echo": "function",
	}

	// Create RPC channel
	rpc := NewRPCChannel(io, api)

	// Get a proxy to the remote API
	remoteAPI := rpc.GetAPI()

	// Example call to a remote method (in a real app, this would be calling a different process)
	ctx := context.Background()
	result, err := remoteAPI.Method("echo").Call(ctx, "Hello from Go!")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
	} else {
		fmt.Printf("Result: %v\n", result)
	}

	// Block forever to keep the process running
	select {}
}
