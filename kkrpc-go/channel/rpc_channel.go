package channel

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"

	"github.com/kunkunsh/kkrpc-go/io"
	"github.com/kunkunsh/kkrpc-go/serialization"
	"github.com/kunkunsh/kkrpc-go/utils"
)

// CallbackFunc represents a callback function
type CallbackFunc func(args ...interface{})

// PendingRequest represents a pending request waiting for a response
type PendingRequest struct {
	ResponseChan chan json.RawMessage
	ErrorChan    chan string
}

// RPCChannel is a bidirectional IPC channel in RPC style
// Similar to the TypeScript RPCChannel
type RPCChannel struct {
	io                io.IoInterface
	apiImplementation interface{}
	pendingRequests   map[string]PendingRequest
	callbacks         map[string]CallbackFunc
	callbackCache     map[uintptr]string
	mutex             sync.RWMutex
	callbackMutex     sync.RWMutex
	serializationOpts serialization.SerializationOptions
	messageBuffer     string
}

// NewRPCChannel creates a new RPCChannel instance
func NewRPCChannel(ioInterface io.IoInterface, options ...RPCOption) *RPCChannel {
	channel := &RPCChannel{
		io:                ioInterface,
		pendingRequests:   make(map[string]PendingRequest),
		callbacks:         make(map[string]CallbackFunc),
		callbackCache:     make(map[uintptr]string),
		serializationOpts: serialization.SerializationOptions{Version: serialization.VersionJSON},
	}

	// Apply options
	for _, option := range options {
		option(channel)
	}

	// Start listening for messages
	go channel.listen()

	return channel
}

// RPCOption configures a RPCChannel
type RPCOption func(*RPCChannel)

// WithAPI sets the API implementation for the RPCChannel
func WithAPI(api interface{}) RPCOption {
	return func(c *RPCChannel) {
		c.apiImplementation = api
	}
}

// WithSerialization sets the serialization options for the RPCChannel
func WithSerialization(opts serialization.SerializationOptions) RPCOption {
	return func(c *RPCChannel) {
		c.serializationOpts = opts
	}
}

// listen continuously reads from the IO interface and processes messages
func (c *RPCChannel) listen() {
	for {
		data, err := c.io.Read()
		if err != nil {
			// Log error but continue
			fmt.Printf("Error reading from IO: %v\n", err)
			continue
		}

		if len(data) == 0 {
			continue
		}

		c.messageBuffer += string(data)

		// Split messages by newline
		messages := strings.Split(c.messageBuffer, "\n")
		lastIdx := len(messages) - 1

		// Process complete messages
		for i := 0; i < lastIdx; i++ {
			msg := strings.TrimSpace(messages[i])
			if msg == "" {
				continue
			}

			// Check if message is JSON
			if strings.HasPrefix(msg, "{") {
				c.handleMessageStr(msg)
			} else {
				// Allow debug logs to passthrough
				fmt.Printf("(kkrpc stdout passthrough): %s\n", msg)
			}
		}

		// Keep the last (potentially incomplete) message
		c.messageBuffer = messages[lastIdx]
	}
}

// handleMessageStr processes a message string
func (c *RPCChannel) handleMessageStr(messageStr string) {
	message, err := serialization.DeserializeMessage(messageStr)
	if err != nil {
		fmt.Printf("Error deserializing message: %v\n", err)
		// Allow non-parseable messages to passthrough
		fmt.Printf("(kkrpc stdout passthrough): %s\n", messageStr)
		return
	}

	switch message.Type {
	case serialization.MessageTypeResponse:
		c.handleResponse(message)
	case serialization.MessageTypeRequest:
		c.handleRequest(message)
	case serialization.MessageTypeCallback:
		c.handleCallback(message)
	default:
		fmt.Printf("Unknown message type: %s\n", message.Type)
	}
}

// handleResponse processes response messages
func (c *RPCChannel) handleResponse(message serialization.Message) {
	c.mutex.RLock()
	pendingRequest, exists := c.pendingRequests[message.ID]
	c.mutex.RUnlock()

	if !exists {
		fmt.Printf("No pending request found for ID: %s\n", message.ID)
		return
	}

	var response serialization.Response
	if err := json.Unmarshal(message.Args, &response); err != nil {
		fmt.Printf("Error unmarshalling response: %v\n", err)
		return
	}

	if response.Error != "" {
		pendingRequest.ErrorChan <- response.Error
	} else {
		pendingRequest.ResponseChan <- response.Result
	}

	c.mutex.Lock()
	delete(c.pendingRequests, message.ID)
	c.mutex.Unlock()
}

// handleRequest processes request messages
func (c *RPCChannel) handleRequest(message serialization.Message) {
	if c.apiImplementation == nil {
		c.sendError(message.ID, "No API implementation provided")
		return
	}

	// Split the method path and traverse the API implementation
	methodPath := strings.Split(message.Method, ".")
	target := reflect.ValueOf(c.apiImplementation)

	// Traverse the object path
	for i := 0; i < len(methodPath)-1; i++ {
		field := target.MethodByName(methodPath[i])
		if !field.IsValid() {
			field = target.Elem().FieldByName(methodPath[i])
			if !field.IsValid() {
				c.sendError(message.ID, fmt.Sprintf("Method path %s not found at %s", message.Method, methodPath[i]))
				return
			}
		}
		target = field
	}

	// Get the final method
	methodName := methodPath[len(methodPath)-1]
	method := target.MethodByName(methodName)
	if !method.IsValid() {
		if target.Kind() == reflect.Ptr {
			method = target.Elem().MethodByName(methodName)
		}
		if !method.IsValid() {
			c.sendError(message.ID, fmt.Sprintf("Method %s not found", methodName))
			return
		}
	}

	if method.Type().Kind() != reflect.Func {
		c.sendError(message.ID, fmt.Sprintf("Method %s is not a function", methodName))
		return
	}

	// Parse arguments
	var args []json.RawMessage
	if err := json.Unmarshal(message.Args, &args); err != nil {
		c.sendError(message.ID, fmt.Sprintf("Failed to parse arguments: %v", err))
		return
	}

	// Process arguments
	callArgs := make([]reflect.Value, 0, len(args))
	callbackIDs := message.CallbackIDs

	for i, arg := range args {
		// Check if this is a callback
		var strArg string
		if err := json.Unmarshal(arg, &strArg); err == nil {
			if strings.HasPrefix(strArg, "__callback__") {
				if len(callbackIDs) > 0 {
					callbackID := callbackIDs[0]
					callbackIDs = callbackIDs[1:]

					// Create callback function
					callbackFunc := c.createCallback(callbackID)
					callbackType := method.Type().In(i)
					callbackValue := reflect.ValueOf(callbackFunc)

					// Convert to the expected callback type
					if !callbackValue.Type().AssignableTo(callbackType) {
						adaptedCallback := c.adaptCallback(callbackFunc, callbackType)
						callArgs = append(callArgs, adaptedCallback)
					} else {
						callArgs = append(callArgs, callbackValue)
					}
					continue
				}
			}
		}

		// Regular argument
		argType := method.Type().In(i)
		argValue := reflect.New(argType)

		if err := json.Unmarshal(arg, argValue.Interface()); err != nil {
			c.sendError(message.ID, fmt.Sprintf("Failed to unmarshal argument %d: %v", i, err))
			return
		}

		callArgs = append(callArgs, argValue.Elem())
	}

	// Call the method
	go func() {
		defer func() {
			if r := recover(); r != nil {
				c.sendError(message.ID, fmt.Sprintf("Panic in method execution: %v", r))
			}
		}()

		results := method.Call(callArgs)

		// Process results
		if len(results) == 0 {
			c.sendResponse(message.ID, nil)
			return
		}

		// Check for error return (assuming last return value is error if multiple)
		var err error
		lastResult := results[len(results)-1]
		if lastResult.Type().Implements(reflect.TypeOf((*error)(nil)).Elem()) {
			if !lastResult.IsNil() {
				err = lastResult.Interface().(error)
				c.sendError(message.ID, err.Error())
				return
			}
			results = results[:len(results)-1] // Remove error from results
		}

		// If we have exactly one result, send it
		if len(results) == 1 {
			result := results[0].Interface()
			resultJSON, err := json.Marshal(result)
			if err != nil {
				c.sendError(message.ID, fmt.Sprintf("Failed to marshal result: %v", err))
				return
			}
			c.sendResponse(message.ID, json.RawMessage(resultJSON))
		} else if len(results) > 1 {
			// If we have multiple results, send them as an array
			resultArray := make([]interface{}, len(results))
			for i, result := range results {
				resultArray[i] = result.Interface()
			}
			resultJSON, err := json.Marshal(resultArray)
			if err != nil {
				c.sendError(message.ID, fmt.Sprintf("Failed to marshal result array: %v", err))
				return
			}
			c.sendResponse(message.ID, json.RawMessage(resultJSON))
		}
	}()
}

// handleCallback processes callback messages
func (c *RPCChannel) handleCallback(message serialization.Message) {
	callbackID := message.Method

	c.callbackMutex.RLock()
	callback, exists := c.callbacks[callbackID]
	c.callbackMutex.RUnlock()

	if !exists {
		fmt.Printf("Callback with ID %s not found\n", callbackID)
		return
	}

	var callbackArgs []interface{}
	if err := json.Unmarshal(message.Args, &callbackArgs); err != nil {
		fmt.Printf("Failed to unmarshal callback arguments: %v\n", err)
		return
	}

	go callback(callbackArgs...)
}

// createCallback creates a callback function for a given ID
func (c *RPCChannel) createCallback(callbackID string) CallbackFunc {
	return func(args ...interface{}) {
		c.invokeCallback(callbackID, args)
	}
}

// adaptCallback adapts a callback function to the expected type
func (c *RPCChannel) adaptCallback(callback CallbackFunc, expectedType reflect.Type) reflect.Value {
	// Create a function with the expected signature
	fn := reflect.MakeFunc(expectedType, func(args []reflect.Value) []reflect.Value {
		// Convert reflect.Values to interface{}
		callArgs := make([]interface{}, len(args))
		for i, arg := range args {
			callArgs[i] = arg.Interface()
		}

		// Call the original callback
		callback(callArgs...)

		// Return zero values if the function is expected to return something
		if expectedType.NumOut() > 0 {
			outValues := make([]reflect.Value, expectedType.NumOut())
			for i := range outValues {
				outValues[i] = reflect.Zero(expectedType.Out(i))
			}
			return outValues
		}

		return nil
	})

	// Return the adapted function
	return fn
}

// invokeCallback sends a callback invocation to the remote endpoint
func (c *RPCChannel) invokeCallback(callbackID string, args []interface{}) {
	messageID := utils.GenerateUUID()

	argsJSON, err := json.Marshal(args)
	if err != nil {
		fmt.Printf("Failed to marshal callback arguments: %v\n", err)
		return
	}

	message := serialization.Message{
		ID:     messageID,
		Method: callbackID,
		Args:   argsJSON,
		Type:   serialization.MessageTypeCallback,
	}

	messageStr, err := serialization.SerializeMessage(message, c.serializationOpts)
	if err != nil {
		fmt.Printf("Failed to serialize callback message: %v\n", err)
		return
	}

	if err := c.io.Write(messageStr); err != nil {
		fmt.Printf("Failed to write callback message: %v\n", err)
	}
}

// sendResponse sends a response message to the remote endpoint
func (c *RPCChannel) sendResponse(id string, result json.RawMessage) {
	response := serialization.Response{
		Result: result,
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		fmt.Printf("Failed to marshal response: %v\n", err)
		return
	}

	message := serialization.Message{
		ID:     id,
		Method: "",
		Args:   responseJSON,
		Type:   serialization.MessageTypeResponse,
	}

	messageStr, err := serialization.SerializeMessage(message, c.serializationOpts)
	if err != nil {
		fmt.Printf("Failed to serialize response message: %v\n", err)
		return
	}

	if err := c.io.Write(messageStr); err != nil {
		fmt.Printf("Failed to write response message: %v\n", err)
	}
}

// sendError sends an error response to the remote endpoint
func (c *RPCChannel) sendError(id string, errorMsg string) {
	response := serialization.Response{
		Error: errorMsg,
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		fmt.Printf("Failed to marshal error response: %v\n", err)
		return
	}

	message := serialization.Message{
		ID:     id,
		Method: "",
		Args:   responseJSON,
		Type:   serialization.MessageTypeResponse,
	}

	messageStr, err := serialization.SerializeMessage(message, c.serializationOpts)
	if err != nil {
		fmt.Printf("Failed to serialize error message: %v\n", err)
		return
	}

	if err := c.io.Write(messageStr); err != nil {
		fmt.Printf("Failed to write error message: %v\n", err)
	}
}

// Call calls a method on the remote API
func (c *RPCChannel) Call(method string, args ...interface{}) (json.RawMessage, error) {
	messageID := utils.GenerateUUID()

	// Process callback arguments
	callbackIDs := []string{}
	processedArgs := make([]interface{}, len(args))

	for i, arg := range args {
		if callback, ok := arg.(func(...interface{})); ok {
			callbackID := c.registerCallback(callback)
			callbackIDs = append(callbackIDs, callbackID)
			processedArgs[i] = fmt.Sprintf("__callback__%s", callbackID)
		} else {
			processedArgs[i] = arg
		}
	}

	// Create request message
	argsJSON, err := json.Marshal(processedArgs)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal arguments: %w", err)
	}

	message := serialization.Message{
		ID:          messageID,
		Method:      method,
		Args:        argsJSON,
		Type:        serialization.MessageTypeRequest,
		CallbackIDs: callbackIDs,
	}

	// Create channels for the response
	responseChan := make(chan json.RawMessage, 1)
	errorChan := make(chan string, 1)

	c.mutex.Lock()
	c.pendingRequests[messageID] = PendingRequest{
		ResponseChan: responseChan,
		ErrorChan:    errorChan,
	}
	c.mutex.Unlock()

	// Send the message
	messageStr, err := serialization.SerializeMessage(message, c.serializationOpts)
	if err != nil {
		c.mutex.Lock()
		delete(c.pendingRequests, messageID)
		c.mutex.Unlock()
		return nil, fmt.Errorf("failed to serialize message: %w", err)
	}

	if err := c.io.Write(messageStr); err != nil {
		c.mutex.Lock()
		delete(c.pendingRequests, messageID)
		c.mutex.Unlock()
		return nil, fmt.Errorf("failed to write message: %w", err)
	}

	// Wait for the response
	select {
	case result := <-responseChan:
		return result, nil
	case errorMsg := <-errorChan:
		return nil, fmt.Errorf("remote error: %s", errorMsg)
	}
}

// registerCallback registers a callback function and returns its ID
func (c *RPCChannel) registerCallback(callback func(...interface{})) string {
	c.callbackMutex.Lock()
	defer c.callbackMutex.Unlock()

	// Get pointer value to use as map key
	ptr := reflect.ValueOf(callback).Pointer()

	// Check if the callback is already registered
	if callbackID, exists := c.callbackCache[ptr]; exists {
		return callbackID
	}

	// Register a new callback
	callbackID := utils.GenerateUUID()
	c.callbacks[callbackID] = callback
	c.callbackCache[ptr] = callbackID

	return callbackID
}

// FreeCallbacks clears all registered callbacks
func (c *RPCChannel) FreeCallbacks() {
	c.callbackMutex.Lock()
	defer c.callbackMutex.Unlock()

	c.callbacks = make(map[string]CallbackFunc)
	c.callbackCache = make(map[uintptr]string)
}
