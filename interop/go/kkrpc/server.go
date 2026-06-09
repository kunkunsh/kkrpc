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
		messageType, _ := message["t"].(string)
		if messageType != "q" {
			continue
		}
		op, _ := message["op"].(string)
		switch op {
		case "call":
			s.handleCall(message)
		case "get":
			s.handleGet(message)
		case "set":
			s.handleSet(message)
		case "new":
			s.handleConstruct(message)
		}
	}
}

func pathFromMessage(message map[string]any) []string {
	pathRaw, _ := message["p"].([]any)
	path := make([]string, 0, len(pathRaw))
	for _, value := range pathRaw {
		if text, ok := value.(string); ok {
			path = append(path, text)
		}
	}
	return path
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
		if envelope, ok := arg.(map[string]any); ok && envelope[ArgEnvelopeTag] == "callback" {
			callbackID, _ := envelope["id"].(string)
			callback := func(callbackArgs ...any) {
				payload := map[string]any{
					"t":  "cb",
					"id": callbackID,
					"a":  callbackArgs,
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
		"t":  "r",
		"id": requestID,
		"v":  result,
	}
	message, err := EncodeMessage(payload)
	if err != nil {
		return
	}
	_ = s.transport.Write(message)
}

func (s *Server) sendError(requestID string, err error) {
	payload := map[string]any{
		"t":  "r",
		"id": requestID,
		"e": map[string]any{
			"n": "Error",
			"m": err.Error(),
		},
	}
	message, encodeErr := EncodeMessage(payload)
	if encodeErr != nil {
		return
	}
	_ = s.transport.Write(message)
}

func (s *Server) handleCall(message map[string]any) {
	requestID, _ := message["id"].(string)
	argsRaw, _ := message["a"].([]any)
	if argsRaw == nil {
		argsRaw = []any{}
	}

	path := pathFromMessage(message)
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
	path := pathFromMessage(message)
	if path == nil {
		s.sendError(requestID, errors.New("missing path"))
		return
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
	path := pathFromMessage(message)
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
	parentMap[path[len(path)-1]] = message["v"]
	s.sendResponse(requestID, true)
}

func (s *Server) handleConstruct(message map[string]any) {
	requestID, _ := message["id"].(string)
	argsRaw, _ := message["a"].([]any)
	if argsRaw == nil {
		argsRaw = []any{}
	}
	path := pathFromMessage(message)
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
