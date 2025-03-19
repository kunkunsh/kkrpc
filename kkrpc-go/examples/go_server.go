package main

import (
	"fmt"

	"github.com/kunkunsh/kkrpc-go/channel"
	"github.com/kunkunsh/kkrpc-go/io"
)

// API defines the methods that will be exposed to JavaScript
type API struct {
	// Add two numbers and return the result
	Add func(a, b int) int

	// Echo returns the same string that was passed in
	Echo func(msg string) string

	// CallCallback demonstrates calling a callback function passed from JavaScript
	CallCallback func(callback func(result string))
}

// Implementation of the API
type APIImpl struct{}

// Add adds two numbers and returns the result
func (a *APIImpl) Add(x, y int) int {
	fmt.Printf("Go Add called with %d, %d\n", x, y)
	return x + y
}

// Echo returns the same string that was passed in
func (a *APIImpl) Echo(msg string) string {
	fmt.Printf("Go Echo called with %s\n", msg)
	return msg
}

// CallCallback calls a callback function passed from JavaScript
func (a *APIImpl) CallCallback(callback func(result string)) {
	fmt.Println("Go CallCallback called")
	callback("Hello from Go!")
}

func main() {
	// Create a stdio interface for bidirectional communication
	stdio := io.NewGoStdio()

	// Create the API implementation
	apiImpl := &APIImpl{}

	// Create a RPC channel and expose the API
	_ = channel.NewRPCChannel(stdio, channel.WithAPI(apiImpl))

	// Block forever (the listen goroutine will handle incoming requests)
	select {}
}
