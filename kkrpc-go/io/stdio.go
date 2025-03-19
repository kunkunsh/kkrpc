package io

import (
	"bufio"
	"fmt"
	"os"
	"sync"
)

// GoStdio implements IoInterface for Go processes using stdin/stdout
type GoStdio struct {
	reader    *bufio.Reader
	writer    *bufio.Writer
	mutex     sync.Mutex
	readMutex sync.Mutex
}

// NewGoStdio creates a new GoStdio instance using the process's stdin/stdout
func NewGoStdio() *GoStdio {
	return &GoStdio{
		reader: bufio.NewReader(os.Stdin),
		writer: bufio.NewWriter(os.Stdout),
	}
}

// Name returns the name of the IO interface
func (s *GoStdio) Name() string {
	return "go-stdio"
}

// Read reads a line from stdin
func (s *GoStdio) Read() ([]byte, error) {
	s.readMutex.Lock()
	defer s.readMutex.Unlock()

	data, err := s.reader.ReadBytes('\n')
	if err != nil {
		return nil, fmt.Errorf("failed to read from stdin: %w", err)
	}

	return data, nil
}

// Write writes data to stdout
func (s *GoStdio) Write(data string) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	_, err := s.writer.WriteString(data)
	if err != nil {
		return fmt.Errorf("failed to write to stdout: %w", err)
	}

	return s.writer.Flush()
}
