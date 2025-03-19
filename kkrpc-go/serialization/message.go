package serialization

import (
	"encoding/json"
	"fmt"
)

// MessageType defines the type of message being sent
type MessageType string

const (
	// MessageTypeRequest for outgoing requests
	MessageTypeRequest MessageType = "request"
	// MessageTypeResponse for responses to requests
	MessageTypeResponse MessageType = "response"
	// MessageTypeCallback for callback invocations
	MessageTypeCallback MessageType = "callback"
)

// SerializationVersion defines the serialization format used
type SerializationVersion string

const (
	// VersionJSON for standard JSON serialization
	VersionJSON SerializationVersion = "json"
	// VersionSuperJSON for enhanced JSON serialization with support for more data types
	VersionSuperJSON SerializationVersion = "superjson"
)

// Message represents a message in the RPC protocol
// This matches the TypeScript Message interface
type Message struct {
	ID          string               `json:"id"`
	Method      string               `json:"method"`
	Args        json.RawMessage      `json:"args"`
	Type        MessageType          `json:"type"`
	CallbackIDs []string             `json:"callbackIds,omitempty"`
	Version     SerializationVersion `json:"version,omitempty"`
}

// Response represents a response message in the RPC protocol
// This matches the TypeScript Response interface
type Response struct {
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

// SerializationOptions contains options for message serialization
// This matches the TypeScript SerializationOptions interface
type SerializationOptions struct {
	Version SerializationVersion `json:"version,omitempty"`
}

// SerializeMessage serializes a message to a string
// This is similar to the TypeScript serializeMessage function
func SerializeMessage(message Message, options SerializationOptions) (string, error) {
	if options.Version == "" {
		options.Version = VersionJSON
	}

	message.Version = options.Version

	// For now, we only implement standard JSON serialization
	// TODO: Add support for superjson-like functionality if needed
	bytes, err := json.Marshal(message)
	if err != nil {
		return "", fmt.Errorf("failed to serialize message: %w", err)
	}

	return string(bytes) + "\n", nil
}

// DeserializeMessage deserializes a message from a string
// This is similar to the TypeScript deserializeMessage function
func DeserializeMessage(messageStr string) (Message, error) {
	var message Message

	// For now, we only implement standard JSON deserialization
	// TODO: Add support for superjson-like functionality if needed
	err := json.Unmarshal([]byte(messageStr), &message)
	if err != nil {
		return Message{}, fmt.Errorf("failed to deserialize message: %w", err)
	}

	return message, nil
}
