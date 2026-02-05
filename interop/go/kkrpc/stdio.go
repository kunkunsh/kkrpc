package kkrpc

import (
	"bufio"
	"io"
	"strings"
	"sync"
)

type StdioTransport struct {
	reader *bufio.Reader
	writer *bufio.Writer
	mu     sync.Mutex
}

func NewStdioTransport(reader io.Reader, writer io.Writer) *StdioTransport {
	return &StdioTransport{
		reader: bufio.NewReader(reader),
		writer: bufio.NewWriter(writer),
	}
}

func (t *StdioTransport) Read() (string, error) {
	line, err := t.reader.ReadString('\n')
	if err != nil {
		if err == io.EOF {
			return "", ErrTransportClosed
		}
		return "", err
	}
	return strings.TrimSpace(line), nil
}

func (t *StdioTransport) Write(message string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, err := t.writer.WriteString(message); err != nil {
		return err
	}
	return t.writer.Flush()
}

func (t *StdioTransport) Close() error {
	return nil
}
