package io

// IoInterface defines the interface for bidirectional communication channels
// Similar to the TypeScript IoInterface
type IoInterface interface {
	// Name returns the name of the IO interface
	Name() string

	// Read reads data from the input source
	// Returns data as bytes or nil if no data is available or error occurs
	Read() ([]byte, error)

	// Write writes data to the output destination
	Write(data string) error
}

// DestroyableIoInterface extends IoInterface with methods to clean up resources
// Similar to the TypeScript DestroyableIoInterface
type DestroyableIoInterface interface {
	IoInterface

	// Destroy cleans up resources
	Destroy() error

	// SignalDestroy signals that resources should be cleaned up
	SignalDestroy() error
}
