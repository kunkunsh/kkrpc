package kkrpc

import "errors"

var ErrTransportClosed = errors.New("transport closed")

type Transport interface {
	Read() (string, error)
	Write(message string) error
	Close() error
}
