package parser

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// A fieldRule describes how to recognize a semantic role (correlation ID,
// timestamp, ...) from field names alone. Exact candidates are ordered by
// how strongly they indicate the role; joined/token signals catch
// non-standard spellings like "ts-unix-ms" or "http_request_id".
type fieldRule struct {
	exact         []string
	joinedSignals []string // matched against the name with separators stripped
	tokenSignals  []string // matched against individual name tokens
}

var correlationRule = fieldRule{
	exact: []string{
		"request_id", "requestId", "req_id", "reqId",
		"trace_id", "traceId", "correlation_id", "correlationId",
		"X-Request-ID", "x-request-id", "X-Correlation-ID",
		"transaction_id", "transactionId", "span_id", "spanId",
	},
	joinedSignals: []string{
		"requestid", "reqid", "traceid", "correlationid", "corrid",
		"transactionid", "txnid", "spanid", "operationid",
	},
}

var timestampRule = fieldRule{
	exact: []string{
		"timestamp", "time", "ts", "@timestamp", "created_at",
		"datetime", "date", "logged_at", "event_time",
	},
	tokenSignals: []string{"timestamp", "time", "ts", "date", "datetime", "stamp"},
}

var serviceRule = fieldRule{
	exact: []string{
		"service", "service_name", "serviceName", "app", "application",
		"component", "logger", "source",
	},
	tokenSignals: []string{"service", "svc", "app", "application", "component", "logger", "source", "module"},
}

var messageRule = fieldRule{
	exact:        []string{"msg", "message", "log", "text"},
	tokenSignals: []string{"msg", "message", "log", "text"},
}

var levelRule = fieldRule{
	exact:        []string{"level", "severity", "log_level"},
	tokenSignals: []string{"level", "severity", "lvl"},
}

var statusRule = fieldRule{
	exact:         []string{"status", "status_code", "statusCode", "http_status"},
	joinedSignals: []string{"statuscode", "httpstatus"},
	tokenSignals:  []string{"status"},
}

var latencyRule = fieldRule{
	exact:         []string{"latency_ms", "latency", "duration_ms", "response_time"},
	joinedSignals: []string{"responsetime", "latencyms", "durationms"},
	tokenSignals:  []string{"latency", "duration", "elapsed", "took"},
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var shortIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{6,}$`)

const scoreThreshold = 4
const valueSampleLimit = 25
const maxAliases = 4

func InferSchema(entries []RawLogEntry) SchemaMap {
	corr := inferField(entries, correlationRule, validCorrelation)
	ts := inferField(entries, timestampRule, validTimestamp)
	svc := inferField(entries, serviceRule, validNonEmptyString)
	msg := inferField(entries, messageRule, validNonEmptyString)
	lvl := inferField(entries, levelRule, validNonEmptyString)
	status := inferField(entries, statusRule, validStatus)
	latency := inferField(entries, latencyRule, validLatency)

	schema := SchemaMap{
		CorrelationID: primary(corr),
		Timestamp:     primary(ts),
		ServiceName:   primary(svc),
		Message:       primary(msg),
		Level:         primary(lvl),
		StatusCode:    primary(status),
		LatencyMs:     primary(latency),
		Aliases:       map[string][]string{},
	}

	for role, fields := range map[string][]string{
		"correlationId": corr, "timestamp": ts, "serviceName": svc,
		"message": msg, "level": lvl, "statusCode": status, "latencyMs": latency,
	} {
		if len(fields) > 1 {
			schema.Aliases[role] = fields[1:]
		}
	}
	return schema
}

func primary(fields []string) string {
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

type valueCheck func(value interface{}) bool

type scoredField struct {
	name     string
	score    int
	exactPos int // -1 when only a token/joined signal matched
}

// inferField returns every field that plausibly plays the role, best first.
// A field is only considered if its NAME signals the role (exact candidate or
// token match) — value shape alone is never enough, which keeps random
// high-cardinality fields from being picked up as correlation IDs.
func inferField(entries []RawLogEntry, rule fieldRule, check valueCheck) []string {
	type fieldInfo struct {
		values []interface{}
		counts map[string]int
	}
	fields := map[string]*fieldInfo{}

	for _, entry := range entries {
		for key, value := range entry.Fields {
			info := fields[key]
			if info == nil {
				info = &fieldInfo{counts: map[string]int{}}
				fields[key] = info
			}
			if len(info.values) < valueSampleLimit {
				info.values = append(info.values, value)
			}
			info.counts[toString(value)]++
		}
	}

	scored := make([]scoredField, 0)
	for name, info := range fields {
		pos := candidatePosition(name, rule.exact)
		signal := pos >= 0 || nameSignal(name, rule)
		if !signal {
			continue
		}

		score := 0
		if pos >= 0 {
			score = basePositionScore(pos)
		} else {
			score = 2
		}

		// Reuse bonus: log fields worth correlating on repeat across lines.
		for _, count := range info.counts {
			if count > 1 {
				score++
				break
			}
		}

		// Value bonus: majority of sampled values look right for the role.
		valid := 0
		for _, v := range info.values {
			if check(v) {
				valid++
			}
		}
		if valid*2 > len(info.values) {
			score += 2
		}

		scored = append(scored, scoredField{name: name, score: score, exactPos: pos})
	}

	sort.Slice(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		iExact, jExact := scored[i].exactPos >= 0, scored[j].exactPos >= 0
		if iExact != jExact {
			return iExact
		}
		if iExact && scored[i].exactPos != scored[j].exactPos {
			return scored[i].exactPos < scored[j].exactPos
		}
		return scored[i].name < scored[j].name
	})

	result := make([]string, 0, maxAliases)
	for _, sf := range scored {
		if sf.score < scoreThreshold || len(result) == maxAliases {
			break
		}
		result = append(result, sf.name)
	}
	return result
}

func nameSignal(field string, rule fieldRule) bool {
	joined := strings.ToLower(stripSeparators(field))
	for _, sig := range rule.joinedSignals {
		if strings.Contains(joined, sig) {
			return true
		}
	}
	if len(rule.tokenSignals) > 0 {
		for _, tok := range nameTokens(field) {
			for _, sig := range rule.tokenSignals {
				if tok == sig {
					return true
				}
			}
		}
	}
	return false
}

func stripSeparators(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '-' || r == '_' || r == '.' || r == '@' || r == ' ' {
			return -1
		}
		return r
	}, s)
}

// nameTokens splits "ts-unix-ms", "eventTime" or "@timestamp" into
// lowercase tokens on separators and camelCase boundaries.
func nameTokens(s string) []string {
	tokens := []string{}
	current := strings.Builder{}
	flush := func() {
		if current.Len() > 0 {
			tokens = append(tokens, strings.ToLower(current.String()))
			current.Reset()
		}
	}
	prevLower := false
	for _, r := range s {
		switch {
		case r == '-' || r == '_' || r == '.' || r == '@' || r == ' ':
			flush()
			prevLower = false
		case unicode.IsUpper(r) && prevLower:
			flush()
			current.WriteRune(r)
			prevLower = false
		default:
			current.WriteRune(r)
			prevLower = unicode.IsLower(r) || unicode.IsDigit(r)
		}
	}
	flush()
	return tokens
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
	switch {
	case position == 0:
		return 3
	case position <= 4:
		return 2
	default:
		return 1
	}
}

func validCorrelation(value interface{}) bool {
	s := toString(value)
	return uuidPattern.MatchString(s) || shortIDPattern.MatchString(s)
}

func validTimestamp(value interface{}) bool {
	_, ok := ParseTimestamp(value)
	return ok
}

func validNonEmptyString(value interface{}) bool {
	s, ok := value.(string)
	return ok && s != ""
}

func validStatus(value interface{}) bool {
	n := toInt(value)
	return n >= 100 && n < 600
}

func validLatency(value interface{}) bool {
	switch v := value.(type) {
	case float64:
		return v > 0 && v < 600000
	case int:
		return v > 0 && v < 600000
	}
	return false
}

func ParseTimestamp(value interface{}) (time.Time, bool) {
	switch v := value.(type) {
	case string:
		formats := []string{
			time.RFC3339Nano,
			time.RFC3339,
			"2006-01-02T15:04:05.000Z",
			"2006-01-02T15:04:05Z",
			"2006-01-02T15:04:05",
			"2006-01-02 15:04:05.000",
			"2006-01-02 15:04:05,000", // python logging asctime
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
	if n > 1e14 {
		// microseconds
		return time.UnixMicro(int64(n)), true
	}
	if n > 1e12 {
		return time.UnixMilli(int64(n)), true
	}
	if n > 1e9 {
		sec := int64(n)
		frac := n - float64(sec)
		return time.Unix(sec, int64(frac*1e9)), true
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
