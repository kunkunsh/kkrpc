package kkrpc

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"time"
)

const CallbackPrefix = "__callback__"

func init() {
	rand.Seed(time.Now().UnixNano())
}

func GenerateUUID() string {
	parts := make([]string, 0, 4)
	for i := 0; i < 4; i++ {
		parts = append(parts, fmt.Sprintf("%x", rand.Int63()))
	}
	return fmt.Sprintf("%s-%s-%s-%s", parts[0], parts[1], parts[2], parts[3])
}

func EncodeMessage(payload map[string]any) (string, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(data) + "\n", nil
}

func DecodeMessage(raw string) (map[string]any, error) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil, err
	}
	return payload, nil
}
