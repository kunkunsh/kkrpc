package proxy

import (
	"encoding/json"
	"fmt"
	"reflect"

	"github.com/kunkunsh/kkrpc-go/channel"
)

// API provides a type-safe way to generate proxy objects for remote API calls
// Instead of using JavaScript Proxy, we use struct embedding and method generation
type API struct {
	channel *channel.RPCChannel
}

// NewAPI creates a new API proxy generator
func NewAPI(channel *channel.RPCChannel) *API {
	return &API{
		channel: channel,
	}
}

// GenerateProxy creates a proxy object for the given API interface
// apiType must be a pointer to a struct with methods
func (a *API) GenerateProxy(apiType interface{}) error {
	typeOfAPI := reflect.TypeOf(apiType)

	// API must be a pointer to a struct
	if typeOfAPI.Kind() != reflect.Ptr || typeOfAPI.Elem().Kind() != reflect.Struct {
		return fmt.Errorf("apiType must be a pointer to a struct, got %s", typeOfAPI.Kind())
	}

	valueOfAPI := reflect.ValueOf(apiType).Elem()
	typeOfStruct := typeOfAPI.Elem()

	// For each field in the struct, create a proxy method
	for i := 0; i < typeOfStruct.NumField(); i++ {
		field := typeOfStruct.Field(i)

		// Check if field is string (method name)
		if field.Type.Kind() == reflect.String {
			// Get the method name from the field tag or field name
			methodName := field.Tag.Get("method")
			if methodName == "" {
				methodName = field.Name
			}

			// Set the field value to the method name
			valueOfAPI.Field(i).SetString(methodName)
		}

		// Check if field is a function
		if field.Type.Kind() == reflect.Func {
			// Get the method name from the field tag or field name
			methodName := field.Tag.Get("method")
			if methodName == "" {
				methodName = field.Name
			}

			// Create a function that will call the remote method
			fn := a.createProxyFunction(methodName, field.Type)

			// Set the field value to the function
			valueOfAPI.Field(i).Set(fn)
		}
	}

	return nil
}

// createProxyFunction creates a function that will call the remote method
func (a *API) createProxyFunction(methodName string, funcType reflect.Type) reflect.Value {
	return reflect.MakeFunc(funcType, func(args []reflect.Value) []reflect.Value {
		// Convert the reflect.Value arguments to interface{}
		callArgs := make([]interface{}, len(args))
		for i, arg := range args {
			callArgs[i] = arg.Interface()
		}

		// Call the remote method
		result, err := a.channel.Call(methodName, callArgs...)

		// Prepare return values
		returnValues := make([]reflect.Value, funcType.NumOut())

		// Last return value should be error if multiple return values
		if funcType.NumOut() > 1 {
			// Set error as the last return value
			if err != nil {
				returnValues[funcType.NumOut()-1] = reflect.ValueOf(err)
			} else {
				returnValues[funcType.NumOut()-1] = reflect.Zero(funcType.Out(funcType.NumOut() - 1))
			}

			// Handle the result for the other return values
			if err == nil && len(result) > 0 {
				// If we have more than one return value, the result should be an array
				var resultArray []json.RawMessage
				if err := json.Unmarshal(result, &resultArray); err != nil {
					// If it's not an array, use the result as a single value
					resultValue := reflect.New(funcType.Out(0))
					if errUnmarshal := json.Unmarshal(result, resultValue.Interface()); errUnmarshal != nil {
						returnValues[0] = reflect.Zero(funcType.Out(0))
					} else {
						returnValues[0] = resultValue.Elem()
					}
				} else {
					// Use the array elements for each return value
					for i := 0; i < len(resultArray) && i < funcType.NumOut()-1; i++ {
						resultValue := reflect.New(funcType.Out(i))
						if errUnmarshal := json.Unmarshal(resultArray[i], resultValue.Interface()); errUnmarshal != nil {
							returnValues[i] = reflect.Zero(funcType.Out(i))
						} else {
							returnValues[i] = resultValue.Elem()
						}
					}
				}
			}
		} else if funcType.NumOut() == 1 {
			// Single return value: either the result or an error
			if funcType.Out(0).Implements(reflect.TypeOf((*error)(nil)).Elem()) {
				// Function returns only an error
				if err != nil {
					returnValues[0] = reflect.ValueOf(err)
				} else {
					returnValues[0] = reflect.Zero(funcType.Out(0))
				}
			} else {
				// Function returns a result
				if err != nil {
					// If there was an error, use zero value
					returnValues[0] = reflect.Zero(funcType.Out(0))
				} else {
					resultValue := reflect.New(funcType.Out(0))
					if errUnmarshal := json.Unmarshal(result, resultValue.Interface()); errUnmarshal != nil {
						returnValues[0] = reflect.Zero(funcType.Out(0))
					} else {
						returnValues[0] = resultValue.Elem()
					}
				}
			}
		}

		return returnValues
	})
}
