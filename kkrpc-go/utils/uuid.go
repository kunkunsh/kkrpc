package utils

import (
	"crypto/rand"
	"fmt"
)

// GenerateUUID generates a random UUID v4
// This is similar to the TypeScript generateUUID function
func GenerateUUID() string {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		return fmt.Sprintf("error-uuid-%d", 1) // Fallback
	}

	// Set version (4) and variant bits
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80

	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
