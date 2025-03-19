module github.com/kunkunsh/kkrpc/packages/kkrpc-go/client_example

go 1.23.3

require github.com/kunkunsh/kkrpc/packages/kkrpc-go/pkg/kkrpc v0.0.0

require github.com/google/uuid v1.4.0 // indirect

replace github.com/kunkunsh/kkrpc/packages/kkrpc-go/pkg/kkrpc => ../pkg/kkrpc
