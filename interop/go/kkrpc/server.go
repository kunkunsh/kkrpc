package kkrpc

import (
	"errors"
	"strings"
	"sync"
)

type Server struct {
	transport Transport
	api       map[string]any
	mu        sync.Mutex
}

func NewServer(transport Transport, api map[string]any) *Server {
	server := &Server{transport: transport, api: api}
	go server.readLoop()
	return server
}

func (s *Server) Close() error {
	return s.transport.Close()
}

func (s *Server) readLoop() {
	for {
		line, err := s.transport.Read()
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
		case "request":
			s.handleRequest(message)
		case "get":
			s.handleGet(message)
		case "set":
			s.handleSet(message)
		case "construct":
			s.handleConstruct(message)
		}
	}
}

func (s *Server) resolvePath(path []string) (any, error) {
	var target any = s.api
	for _, part := range path {
		obj, ok := target.(map[string]any)
		if !ok {
			return nil, errors.New("invalid path")
		}
		value, exists := obj[part]
		if !exists {
			return nil, errors.New("path not found")
		}
		target = value
	}
	return target, nil
}

func (s *Server) wrapCallbacks(args []any, requestID string) []any {
	processed := make([]any, 0, len(args))
	for _, arg := range args {
		text, ok := arg.(string)
		if ok && strings.HasPrefix(text, CallbackPrefix) {
			callbackID := strings.TrimPrefix(text, CallbackPrefix)
			callback := func(callbackArgs ...any) {
				payload := map[string]any{
					"id":      requestID,
					"method":  callbackID,
					"args":    callbackArgs,
					"type":    "callback",
					"version": "json",
				}
				message, err := EncodeMessage(payload)
				if err != nil {
					return
				}
				_ = s.transport.Write(message)
			}
			processed = append(processed, Callback(callback))
			continue
		}
		processed = append(processed, arg)
	}
	return processed
}

func (s *Server) sendResponse(requestID string, result any) {
	payload := map[string]any{
		"id":      requestID,
		"method":  "",
		"args":    map[string]any{"result": result},
		"type":    "response",
		"version": "json",
	}
	message, err := EncodeMessage(payload)
	if err != nil {
		return
	}
	_ = s.transport.Write(message)
}

func (s *Server) sendError(requestID string, err error) {
	payload := map[string]any{
		"id":     requestID,
		"method": "",
		"args": map[string]any{
			"error": map[string]any{
				"name":    "Error",
				"message": err.Error(),
			},
		},
		"type":    "response",
		"version": "json",
	}
	message, encodeErr := EncodeMessage(payload)
	if encodeErr != nil {
		return
	}
	_ = s.transport.Write(message)
}

func (s *Server) handleRequest(message map[string]any) {
	requestID, _ := message["id"].(string)
	method, _ := message["method"].(string)
	argsRaw, _ := message["args"].([]any)
	if argsRaw == nil {
		argsRaw = []any{}
	}

	path := []string{}
	if method != "" {
		path = strings.Split(method, ".")
	}
	resolved, err := s.resolvePath(path)
	if err != nil {
		s.sendError(requestID, err)
		return
	}
	callable, ok := resolved.(func(...any) any)
	if !ok {
		s.sendError(requestID, errors.New("method not callable"))
		return
	}

	result := callable(s.wrapCallbacks(argsRaw, requestID)...)
	s.sendResponse(requestID, result)
}

func (s *Server) handleGet(message map[string]any) {
	requestID, _ := message["id"].(string)
	pathRaw, _ := message["path"].([]any)
	if pathRaw == nil {
		s.sendError(requestID, errors.New("missing path"))
		return
	}
	path := make([]string, 0, len(pathRaw))
	for _, value := range pathRaw {
		if text, ok := value.(string); ok {
			path = append(path, text)
		}
	}
	result, err := s.resolvePath(path)
	if err != nil {
		s.sendError(requestID, err)
		return
	}
	s.sendResponse(requestID, result)
}

func (s *Server) handleSet(message map[string]any) {
	requestID, _ := message["id"].(string)
	pathRaw, _ := message["path"].([]any)
	if len(pathRaw) == 0 {
		s.sendError(requestID, errors.New("missing path"))
		return
	}
	path := make([]string, 0, len(pathRaw))
	for _, value := range pathRaw {
		if text, ok := value.(string); ok {
			path = append(path, text)
		}
	}
	if len(path) == 0 {
		s.sendError(requestID, errors.New("missing path"))
		return
	}
	parent, err := s.resolvePath(path[:len(path)-1])
	if err != nil {
		s.sendError(requestID, err)
		return
	}
	parentMap, ok := parent.(map[string]any)
	if !ok {
		s.sendError(requestID, errors.New("set target is not object"))
		return
	}
	parentMap[path[len(path)-1]] = message["value"]
	s.sendResponse(requestID, true)
}

func (s *Server) handleConstruct(message map[string]any) {
	requestID, _ := message["id"].(string)
	method, _ := message["method"].(string)
	argsRaw, _ := message["args"].([]any)
	if argsRaw == nil {
		argsRaw = []any{}
	}
	path := []string{}
	if method != "" {
		path = strings.Split(method, ".")
	}
	resolved, err := s.resolvePath(path)
	if err != nil {
		s.sendError(requestID, err)
		return
	}
	constructor, ok := resolved.(func(...any) any)
	if !ok {
		s.sendError(requestID, errors.New("constructor not callable"))
		return
	}
	result := constructor(s.wrapCallbacks(argsRaw, requestID)...)
	s.sendResponse(requestID, result)
}
