package parser

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

// DecodeLogs accepts either a JSON array of objects or newline-delimited
// JSON (one object per line). In line mode, unparseable lines are skipped
// and counted rather than failing the whole paste.
func DecodeLogs(input string) ([]map[string]interface{}, int, error) {
	trimmed := strings.TrimSpace(input)
	if strings.HasPrefix(trimmed, "[") {
		var arr []map[string]interface{}
		if err := json.Unmarshal([]byte(trimmed), &arr); err == nil {
			return arr, 0, nil
		}
	}

	malformed := 0
	out := []map[string]interface{}{}
	for _, line := range strings.Split(input, "\n") {
		l := strings.TrimSpace(line)
		l = strings.TrimSuffix(l, ",")
		if l == "" || l == "[" || l == "]" {
			continue
		}
		var m map[string]interface{}
		if err := json.Unmarshal([]byte(l), &m); err != nil {
			malformed++
			continue
		}
		out = append(out, m)
	}

	if len(out) == 0 {
		return nil, malformed, errors.New("no valid JSON log entries found — expected a JSON array or newline-delimited JSON objects")
	}
	return out, malformed, nil
}

func ParseEntries(raw []map[string]interface{}, schema SchemaMap) ([]LogEntry, ParseStats) {
	entries := make([]LogEntry, 0, len(raw))
	stats := ParseStats{TotalEntries: len(raw)}

	for _, fields := range raw {
		tsValue := getField(fields, schema.Timestamp, schema.Aliases["timestamp"], timestampRule.exact)
		ts, ok := ParseTimestamp(tsValue)
		if !ok {
			stats.MissingTimestamp++
			continue
		}

		entry := LogEntry{
			CorrelationID: toString(getField(fields, schema.CorrelationID, schema.Aliases["correlationId"], correlationRule.exact)),
			Timestamp:     ts,
			ServiceName:   toString(getField(fields, schema.ServiceName, schema.Aliases["serviceName"], serviceRule.exact)),
			Message:       toString(getField(fields, schema.Message, schema.Aliases["message"], messageRule.exact)),
			Level:         strings.ToLower(toString(getField(fields, schema.Level, schema.Aliases["level"], levelRule.exact))),
			StatusCode:    toInt(getField(fields, schema.StatusCode, schema.Aliases["statusCode"], statusRule.exact)),
			LatencyMs:     toInt(getField(fields, schema.LatencyMs, schema.Aliases["latencyMs"], latencyRule.exact)),
			RawFields:     fields,
		}

		if entry.CorrelationID == "" {
			stats.MissingCorrelationID++
		}
		if entry.ServiceName == "" {
			entry.ServiceName = "unknown"
		}

		entries = append(entries, entry)
	}

	stats.ParsedEntries = len(entries)
	return entries, stats
}

// getField resolves a role for one entry: the inferred primary field first,
// then dump-level aliases (mixed conventions), then the exact candidate list.
func getField(fields map[string]interface{}, inferred string, aliases []string, candidates []string) interface{} {
	if inferred != "" {
		if v, ok := fields[inferred]; ok {
			return v
		}
	}
	for _, alias := range aliases {
		if v, ok := fields[alias]; ok {
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
