package kkrpc

import (
	"testing"
	"time"
)

type serverTestTransport struct {
	in     chan string
	out    chan string
	closed chan struct{}
}

func newServerTestTransport() *serverTestTransport {
	return &serverTestTransport{
		in:     make(chan string, 1),
		out:    make(chan string, 1),
		closed: make(chan struct{}),
	}
}

func (t *serverTestTransport) Read() (string, error) {
	select {
	case line := <-t.in:
		return line, nil
	case <-t.closed:
		return "", ErrTransportClosed
	}
}

func (t *serverTestTransport) Write(message string) error {
	t.out <- message
	return nil
}

func (t *serverTestTransport) Close() error {
	select {
	case <-t.closed:
	default:
		close(t.closed)
	}
	return nil
}

func TestServerUnwrapsStableValueEnvelopeArgs(t *testing.T) {
	transport := newServerTestTransport()
	defer transport.Close()

	api := map[string]any{
		"echo": func(args ...any) any {
			return args[0]
		},
	}
	_ = NewServer(transport, api)

	request, err := EncodeMessage(map[string]any{
		"t":  "q",
		"id": "value-envelope",
		"op": "call",
		"p":  []any{"echo"},
		"a": []any{
			map[string]any{ArgEnvelopeTag: "value", "v": "payload"},
		},
	})
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}

	transport.in <- request

	select {
	case raw := <-transport.out:
		message, err := DecodeMessage(raw)
		if err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if message["v"] != "payload" {
			t.Fatalf("expected raw payload, got %#v", message["v"])
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("server response not received")
	}
}
