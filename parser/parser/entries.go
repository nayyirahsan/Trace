package parser

import (
	"strconv"
	"strings"
)

func ParseEntries(raw []map[string]interface{}, schema SchemaMap) []LogEntry {
	entries := make([]LogEntry, 0, len(raw))

	for _, fields := range raw {
		tsValue := getField(fields, schema.Timestamp, timestampCandidates...)
		ts, ok := ParseTimestamp(tsValue)
		if !ok {
			continue
		}

		entry := LogEntry{
			CorrelationID: toString(getField(fields, schema.CorrelationID, correlationIDCandidates...)),
			Timestamp:     ts,
			ServiceName:   toString(getField(fields, schema.ServiceName, serviceNameCandidates...)),
			Message:       toString(getField(fields, schema.Message, messageCandidates...)),
			Level:         strings.ToLower(toString(getField(fields, schema.Level, levelCandidates...))),
			StatusCode:    toInt(getField(fields, schema.StatusCode, statusCodeCandidates...)),
			LatencyMs:     toInt(getField(fields, schema.LatencyMs, latencyCandidates...)),
			RawFields:     fields,
		}

		if entry.ServiceName == "" {
			entry.ServiceName = "unknown"
		}

		entries = append(entries, entry)
	}

	return entries
}

func getField(fields map[string]interface{}, inferred string, candidates ...string) interface{} {
	if inferred != "" {
		if v, ok := fields[inferred]; ok {
			return v
		}
	}
	for _, key := range candidates {
		for fieldKey, v := range fields {
			if strings.EqualFold(fieldKey, key) {
				return v
			}
		}
	}
	return nil
}

func toInt(value interface{}) int {
	switch v := value.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case string:
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return 0
}
