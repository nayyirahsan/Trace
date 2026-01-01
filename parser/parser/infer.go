package parser

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

var correlationIDCandidates = []string{
	"request_id", "requestId", "req_id", "reqId",
	"trace_id", "traceId", "correlation_id", "correlationId",
	"X-Request-ID", "x-request-id", "X-Correlation-ID",
	"transaction_id", "transactionId", "span_id", "spanId",
}

var timestampCandidates = []string{
	"timestamp", "time", "ts", "@timestamp", "created_at",
	"datetime", "date", "logged_at", "event_time",
}

var serviceNameCandidates = []string{
	"service", "service_name", "serviceName", "app", "application",
	"component", "logger", "source",
}

var messageCandidates = []string{
	"msg", "message", "log", "text",
}

var levelCandidates = []string{
	"level", "severity", "log_level",
}

var statusCodeCandidates = []string{
	"status", "status_code", "statusCode", "http_status",
}

var latencyCandidates = []string{
	"latency_ms", "latency", "duration_ms", "response_time",
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var shortIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{6,}$`)

const scoreThreshold = 3

func InferSchema(entries []RawLogEntry) SchemaMap {
	return SchemaMap{
		CorrelationID: inferField(entries, correlationIDCandidates, scoreCorrelation),
		Timestamp:     inferField(entries, timestampCandidates, scoreTimestamp),
		ServiceName:   inferField(entries, serviceNameCandidates, scoreGeneric),
		Message:       inferField(entries, messageCandidates, scoreGeneric),
		Level:         inferField(entries, levelCandidates, scoreGeneric),
		StatusCode:    inferField(entries, statusCodeCandidates, scoreStatusCode),
		LatencyMs:     inferField(entries, latencyCandidates, scoreLatency),
	}
}

type scoreFunc func(field string, value interface{}, position int, reuseBonus int) int

func inferField(entries []RawLogEntry, candidates []string, scorer scoreFunc) string {
	fieldScores := map[string]int{}
	valueCounts := map[string]map[string]int{}

	for _, entry := range entries {
		for key, value := range entry.Fields {
			if valueCounts[key] == nil {
				valueCounts[key] = map[string]int{}
			}
			valueCounts[key][toString(value)]++
		}
	}

	for fieldName := range valueCounts {
		position := candidatePosition(fieldName, candidates)
		maxReuse := 0
		for _, count := range valueCounts[fieldName] {
			if count > maxReuse {
				maxReuse = count
			}
		}
		reuseBonus := 0
		if maxReuse > 1 {
			reuseBonus = 1
		}

		for _, entry := range entries {
			value, ok := entry.Fields[fieldName]
			if !ok {
				continue
			}
			fieldScores[fieldName] += scorer(fieldName, value, position, reuseBonus)
			break
		}
	}

	bestField := ""
	bestScore := 0
	for field, score := range fieldScores {
		if score > bestScore {
			bestScore = score
			bestField = field
		}
	}

	if bestScore < scoreThreshold {
		return ""
	}
	return bestField
}

func candidatePosition(field string, candidates []string) int {
	for i, c := range candidates {
		if strings.EqualFold(field, c) {
			return i
		}
	}
	return -1
}

func basePositionScore(position int) int {
	if position < 0 {
		return 0
	}
	switch {
	case position == 0:
		return 3
	case position <= 2:
		return 2
	default:
		return 1
	}
}

func scoreCorrelation(_ string, value interface{}, position int, reuseBonus int) int {
	score := basePositionScore(position) + reuseBonus
	strVal := toString(value)
	if uuidPattern.MatchString(strVal) || shortIDPattern.MatchString(strVal) {
		score += 2
	}
	return score
}

func scoreTimestamp(_ string, value interface{}, position int, reuseBonus int) int {
	score := basePositionScore(position) + reuseBonus
	if _, ok := ParseTimestamp(value); ok {
		score += 2
	}
	return score
}

func scoreGeneric(_ string, _ interface{}, position int, reuseBonus int) int {
	return basePositionScore(position) + reuseBonus
}

func scoreStatusCode(_ string, value interface{}, position int, reuseBonus int) int {
	score := basePositionScore(position) + reuseBonus
	switch v := value.(type) {
	case float64:
		if v >= 100 && v < 600 {
			score += 2
		}
	case int:
		if v >= 100 && v < 600 {
			score += 2
		}
	case string:
		if n, err := strconv.Atoi(v); err == nil && n >= 100 && n < 600 {
			score += 2
		}
	}
	return score
}

func scoreLatency(_ string, value interface{}, position int, reuseBonus int) int {
	score := basePositionScore(position) + reuseBonus
	switch v := value.(type) {
	case float64:
		if v > 0 && v < 600000 {
			score += 2
		}
	case int:
		if v > 0 && v < 600000 {
			score += 2
		}
	}
	return score
}

func ParseTimestamp(value interface{}) (time.Time, bool) {
	switch v := value.(type) {
	case string:
		formats := []string{
			time.RFC3339Nano,
			time.RFC3339,
			"2006-01-02T15:04:05.000Z",
			"2006-01-02T15:04:05Z",
			"2006/01/02 15:04:05",
			"2006-01-02 15:04:05",
		}
		for _, layout := range formats {
			if t, err := time.Parse(layout, v); err == nil {
				return t, true
			}
		}
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return fromUnixNumber(f)
		}
	case float64:
		return fromUnixNumber(v)
	case int:
		return fromUnixNumber(float64(v))
	case int64:
		return fromUnixNumber(float64(v))
	}
	return time.Time{}, false
}

func fromUnixNumber(n float64) (time.Time, bool) {
	if n > 1e12 {
		ms := int64(n)
		return time.UnixMilli(ms), true
	}
	if n > 1e9 {
		sec := int64(n)
		return time.Unix(sec, 0), true
	}
	return time.Time{}, false
}

func toString(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case float64:
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	default:
		return ""
	}
}
