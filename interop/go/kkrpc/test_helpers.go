package kkrpc

import "fmt"

func compareMaps(expected map[string]any, actual any) bool {
	actualMap, ok := actual.(map[string]any)
	if !ok {
		return false
	}
	for key, value := range expected {
		actualValue, exists := actualMap[key]
		if !exists || !valuesEqual(value, actualValue) {
			return false
		}
	}
	return true
}

func valuesEqual(expected any, actual any) bool {
	if expectedNumber, ok := toFloat64(expected); ok {
		if actualNumber, ok := toFloat64(actual); ok {
			return expectedNumber == actualNumber
		}
	}
	return expected == actual
}

func toFloat64(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	default:
		return 0, false
	}
}

func toString(value any) string {
	return fmt.Sprintf("%v", value)
}
