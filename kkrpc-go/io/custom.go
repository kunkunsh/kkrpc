package io

// CustomIO implements IoInterface with customizable read and write functions
type CustomIO struct {
	Name_   string
	ReadFn  func() ([]byte, error)
	WriteFn func(data string) error
}

// Name returns the name of the IO interface
func (c *CustomIO) Name() string {
	return c.Name_
}

// Read reads data from the input source using the provided ReadFn
func (c *CustomIO) Read() ([]byte, error) {
	return c.ReadFn()
}

// Write writes data to the output destination using the provided WriteFn
func (c *CustomIO) Write(data string) error {
	return c.WriteFn(data)
}
