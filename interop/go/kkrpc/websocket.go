package kkrpc

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"sync"
)

type WebSocketTransport struct {
	conn   net.Conn
	reader *bufio.Reader
	mu     sync.Mutex
}

func NewWebSocketTransport(rawURL string) (*WebSocketTransport, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "ws" {
		return nil, fmt.Errorf("unsupported scheme: %s", parsed.Scheme)
	}
	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		port = "80"
	}
	path := parsed.Path
	if path == "" {
		path = "/"
	}
	if parsed.RawQuery != "" {
		path = path + "?" + parsed.RawQuery
	}

	conn, err := net.Dial("tcp", net.JoinHostPort(host, port))
	if err != nil {
		return nil, err
	}
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		_ = conn.Close()
		return nil, err
	}
	secKey := base64.StdEncoding.EncodeToString(keyBytes)
	request := strings.Join([]string{
		fmt.Sprintf("GET %s HTTP/1.1", path),
		fmt.Sprintf("Host: %s", parsed.Host),
		"Upgrade: websocket",
		"Connection: Upgrade",
		fmt.Sprintf("Sec-WebSocket-Key: %s", secKey),
		"Sec-WebSocket-Version: 13",
		"\r\n",
	}, "\r\n")

	if _, err := conn.Write([]byte(request)); err != nil {
		_ = conn.Close()
		return nil, err
	}
	reader := bufio.NewReader(conn)
	response, err := readHTTPResponse(reader)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if !strings.Contains(response, " 101 ") {
		_ = conn.Close()
		return nil, fmt.Errorf("websocket handshake failed")
	}
	accept := computeAccept(secKey)
	if !strings.Contains(strings.ToLower(response), strings.ToLower("Sec-WebSocket-Accept: "+accept)) {
		_ = conn.Close()
		return nil, fmt.Errorf("websocket accept mismatch")
	}

	return &WebSocketTransport{conn: conn, reader: reader}, nil
}

func (t *WebSocketTransport) Read() (string, error) {
	header, err := t.readExact(2)
	if err != nil {
		return "", err
	}
	byte1 := header[0]
	byte2 := header[1]
	opcode := byte1 & 0x0F
	if opcode == 0x8 {
		return "", ErrTransportClosed
	}
	length := int(byte2 & 0x7F)
	if length == 126 {
		buf, err := t.readExact(2)
		if err != nil {
			return "", err
		}
		length = int(buf[0])<<8 | int(buf[1])
	} else if length == 127 {
		buf, err := t.readExact(8)
		if err != nil {
			return "", err
		}
		length = 0
		for _, b := range buf {
			length = length<<8 + int(b)
		}
	}
	masked := (byte2 & 0x80) != 0
	mask := []byte{0, 0, 0, 0}
	if masked {
		mask, err = t.readExact(4)
		if err != nil {
			return "", err
		}
	}
	payload, err := t.readExact(length)
	if err != nil {
		return "", err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return string(payload), nil
}

func (t *WebSocketTransport) Write(message string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	payload := []byte(message)
	length := len(payload)
	byte1 := byte(0x80 | 0x1)
	maskKey := make([]byte, 4)
	if _, err := rand.Read(maskKey); err != nil {
		return err
	}
	var header []byte
	if length <= 125 {
		header = []byte{byte1, byte(0x80 | length)}
	} else if length <= 65535 {
		header = []byte{byte1, 0x80 | 126, byte(length >> 8), byte(length)}
	} else {
		header = []byte{byte1, 0x80 | 127,
			0, 0, 0, 0,
			byte(length >> 24), byte(length >> 16), byte(length >> 8), byte(length),
		}
	}
	masked := make([]byte, length)
	for i, b := range payload {
		masked[i] = b ^ maskKey[i%4]
	}
	if _, err := t.conn.Write(header); err != nil {
		return err
	}
	if _, err := t.conn.Write(maskKey); err != nil {
		return err
	}
	_, err := t.conn.Write(masked)
	return err
}

func (t *WebSocketTransport) Close() error {
	return t.conn.Close()
}

func (t *WebSocketTransport) readExact(length int) ([]byte, error) {
	buffer := make([]byte, length)
	_, err := io.ReadFull(t.reader, buffer)
	return buffer, err
}

func readHTTPResponse(reader *bufio.Reader) (string, error) {
	var builder strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return "", err
		}
		builder.WriteString(line)
		if line == "\r\n" {
			break
		}
	}
	return builder.String(), nil
}

func computeAccept(key string) string {
	hasher := sha1.New()
	_, _ = hasher.Write([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(hasher.Sum(nil))
}
