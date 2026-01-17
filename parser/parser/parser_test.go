package parser

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func loadSample(t *testing.T, name string) ([]map[string]interface{}, int) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "test_logs", name))
	if err != nil {
		t.Fatal(err)
	}
	raw, malformed, err := DecodeLogs(string(data))
	if err != nil {
		t.Fatal(err)
	}
	return raw, malformed
}

func toRaw(raw []map[string]interface{}) []RawLogEntry {
	entries := make([]RawLogEntry, len(raw))
	for i, fields := range raw {
		entries[i] = RawLogEntry{Fields: fields}
	}
	return entries
}

// TestInferenceAccuracy checks zero-config schema inference against every
// sample format. The README quotes the pass count from this test.
func TestInferenceAccuracy(t *testing.T) {
	cases := []struct {
		file     string
		expected SchemaMap // expected primary fields; empty string = don't care
	}{
		{
			file: "express_sample.json",
			expected: SchemaMap{
				CorrelationID: "reqId", Timestamp: "time", ServiceName: "service",
				Message: "message", Level: "level",
			},
		},
		{
			file: "fastapi_sample.json",
			expected: SchemaMap{
				CorrelationID: "correlation_id", Timestamp: "timestamp", ServiceName: "logger",
				Message: "message", Level: "level",
			},
		},
		{
			file: "rails_sample.json",
			expected: SchemaMap{
				CorrelationID: "request_id", Timestamp: "created_at", ServiceName: "service_name",
				Message: "message", Level: "severity",
			},
		},
		{
			file: "go_stdlib_sample.json",
			expected: SchemaMap{
				CorrelationID: "traceId", Timestamp: "ts", ServiceName: "component",
				Message: "msg", Level: "level",
			},
		},
		{
			file: "mixed_services_sample.json",
			expected: SchemaMap{
				CorrelationID: "request_id", Timestamp: "timestamp", ServiceName: "service",
				Message: "msg", Level: "level",
			},
		},
		{
			file: "ndjson_mixed_conventions.ndjson",
			expected: SchemaMap{
				CorrelationID: "request_id", Timestamp: "timestamp", ServiceName: "service",
				Message: "msg", Level: "level",
			},
		},
	}

	totalRoles := 0
	correctRoles := 0

	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			raw, _ := loadSample(t, tc.file)
			schema := InferSchema(toRaw(raw))

			checks := []struct {
				role     string
				got      string
				expected string
			}{
				{"correlationId", schema.CorrelationID, tc.expected.CorrelationID},
				{"timestamp", schema.Timestamp, tc.expected.Timestamp},
				{"serviceName", schema.ServiceName, tc.expected.ServiceName},
				{"message", schema.Message, tc.expected.Message},
				{"level", schema.Level, tc.expected.Level},
			}
			for _, c := range checks {
				if c.expected == "" {
					continue
				}
				totalRoles++
				if c.got == c.expected {
					correctRoles++
				} else {
					t.Errorf("%s: expected %q, inferred %q", c.role, c.expected, c.got)
				}
			}
		})
	}

	t.Logf("inference accuracy: %d/%d roles correct across %d formats", correctRoles, totalRoles, len(cases))
}

// The mixed dump uses request_id AND req_id, epoch-ms AND ISO8601,
// service AND app — aliases must cover the secondary conventions.
func TestMixedConventionAliases(t *testing.T) {
	raw, _ := loadSample(t, "mixed_services_sample.json")
	schema := InferSchema(toRaw(raw))

	assertAlias := func(role, field string) {
		t.Helper()
		for _, a := range schema.Aliases[role] {
			if a == field {
				return
			}
		}
		t.Errorf("expected %q in aliases[%s], got %v", field, role, schema.Aliases[role])
	}
	assertAlias("correlationId", "req_id")
	assertAlias("timestamp", "ts")
	assertAlias("serviceName", "app")
}

func TestMixedServicesTimeline(t *testing.T) {
	raw, _ := loadSample(t, "mixed_services_sample.json")
	schema := InferSchema(toRaw(raw))
	entries, stats := ParseEntries(raw, schema)

	if stats.MissingTimestamp != 1 {
		t.Errorf("expected 1 entry without timestamp, got %d", stats.MissingTimestamp)
	}
	if stats.MissingCorrelationID != 1 {
		t.Errorf("expected 1 entry without correlation id, got %d", stats.MissingCorrelationID)
	}

	timeline := BuildTimeline(entries, "abc-123")
	if timeline.EventCount == 0 {
		t.Fatal("expected events for abc-123")
	}
	if len(timeline.Services) < 3 {
		t.Errorf("expected at least 3 services, got %d", len(timeline.Services))
	}
	if timeline.FailurePoint == nil {
		t.Error("expected failure point")
	} else if timeline.FailurePoint.ServiceName != "order-service" {
		t.Errorf("expected failure at order-service, got %s", timeline.FailurePoint.ServiceName)
	}
	if timeline.LastSuccess == nil {
		t.Error("expected last success before failure")
	}
}

func TestNDJSONMixedConventions(t *testing.T) {
	raw, malformed := loadSample(t, "ndjson_mixed_conventions.ndjson")
	if malformed != 2 {
		t.Errorf("expected 2 malformed lines, got %d", malformed)
	}

	schema := InferSchema(toRaw(raw))
	entries, stats := ParseEntries(raw, schema)

	if stats.MissingTimestamp != 1 {
		t.Errorf("expected 1 missing-timestamp entry, got %d", stats.MissingTimestamp)
	}
	if stats.MissingCorrelationID != 1 {
		t.Errorf("expected 1 missing-correlation entry, got %d", stats.MissingCorrelationID)
	}

	timeline := BuildTimeline(entries, "ord-77f2")
	if timeline.EventCount != 8 {
		t.Errorf("expected 8 events for ord-77f2, got %d", timeline.EventCount)
	}
	if len(timeline.Services) != 3 {
		t.Fatalf("expected 3 services (edge-proxy, checkout, inventory), got %d", len(timeline.Services))
	}
	if timeline.FailurePoint == nil {
		t.Fatal("expected a failure point")
	}
	if timeline.FailurePoint.ServiceName != "inventory" {
		t.Errorf("expected first failure at inventory, got %s", timeline.FailurePoint.ServiceName)
	}
	if timeline.LastSuccess == nil {
		t.Fatal("expected last success")
	}
	if timeline.LastSuccess.RelativeMs != 150 {
		t.Errorf("expected last success at 150ms, got %d", timeline.LastSuccess.RelativeMs)
	}
}

// Regression: the old clock-skew heuristic shifted any service whose first
// event fell inside the previous lane's window — i.e. every normally
// interleaved downstream service. Raw timestamps must be preserved.
func TestInterleavedServicesNotShifted(t *testing.T) {
	raw, _ := loadSample(t, "mixed_services_sample.json")
	schema := InferSchema(toRaw(raw))
	entries, _ := ParseEntries(raw, schema)
	timeline := BuildTimeline(entries, "abc-123")

	for _, svc := range timeline.Services {
		if svc.ServiceName != "auth-service" {
			continue
		}
		if svc.Events[0].RelativeMs != 120 {
			t.Errorf("auth-service first event should stay at 120ms, got %dms", svc.Events[0].RelativeMs)
		}
	}
	if timeline.SuspectedSkew != nil {
		t.Errorf("no skew expected for consistent clocks, got %v", timeline.SuspectedSkew)
	}
}

func TestClockSkewDetection(t *testing.T) {
	raw, _ := loadSample(t, "clock_skew_sample.json")
	schema := InferSchema(toRaw(raw))
	entries, _ := ParseEntries(raw, schema)
	timeline := BuildTimeline(entries, "pay-555")

	if len(timeline.SuspectedSkew) != 1 {
		t.Fatalf("expected 1 skew warning, got %v", timeline.SuspectedSkew)
	}
	w := timeline.SuspectedSkew[0]
	if w.ServiceName != "billing-service" {
		t.Errorf("expected billing-service flagged, got %s", w.ServiceName)
	}
	if w.OffsetMs != -119800 {
		t.Errorf("expected offset -119800ms, got %d", w.OffsetMs)
	}
}

func TestLastSuccessTieAtFailureTimestamp(t *testing.T) {
	base := time.UnixMilli(1719849600000)
	entries := []LogEntry{
		{CorrelationID: "t-1", Timestamp: base.Add(50 * time.Millisecond), ServiceName: "svc-a", Message: "step one ok", Level: "info"},
		{CorrelationID: "t-1", Timestamp: base.Add(100 * time.Millisecond), ServiceName: "svc-a", Message: "step two ok", Level: "info"},
		{CorrelationID: "t-1", Timestamp: base.Add(100 * time.Millisecond), ServiceName: "svc-b", Message: "boom", Level: "error"},
	}
	timeline := BuildTimeline(entries, "t-1")

	if timeline.FailurePoint == nil || timeline.FailurePoint.ServiceName != "svc-b" {
		t.Fatalf("expected failure at svc-b, got %+v", timeline.FailurePoint)
	}
	// earliest event is at +50ms, so the tied events land at relative 50ms
	if timeline.LastSuccess == nil || timeline.LastSuccess.RelativeMs != 50 || timeline.LastSuccess.ServiceName != "svc-a" || timeline.LastSuccess.Message != "step two ok" {
		t.Fatalf("expected last success svc-a 'step two ok' @50ms, got %+v", timeline.LastSuccess)
	}
	if !timeline.LastSuccess.IsLastSuccess {
		t.Error("last success event should be marked in its lane")
	}
}

func TestExpressTimeline(t *testing.T) {
	raw, _ := loadSample(t, "express_sample.json")
	schema := InferSchema(toRaw(raw))
	entries, _ := ParseEntries(raw, schema)
	timeline := BuildTimeline(entries, "exp-002")

	if timeline.EventCount == 0 {
		t.Fatal("expected events for exp-002")
	}
	if timeline.FailurePoint == nil {
		t.Error("expected failure for exp-002")
	}
}

func TestNoMatchingCorrelationID(t *testing.T) {
	raw, _ := loadSample(t, "mixed_services_sample.json")
	schema := InferSchema(toRaw(raw))
	entries, _ := ParseEntries(raw, schema)
	timeline := BuildTimeline(entries, "nonexistent-id")

	if timeline.EventCount != 0 {
		t.Errorf("expected 0 events, got %d", timeline.EventCount)
	}
}

// Entries with an empty correlation ID must never be swept into a timeline.
func TestEmptyCorrelationIDReturnsNothing(t *testing.T) {
	raw, _ := loadSample(t, "mixed_services_sample.json")
	schema := InferSchema(toRaw(raw))
	entries, _ := ParseEntries(raw, schema)
	timeline := BuildTimeline(entries, "")

	if timeline.EventCount != 0 {
		t.Errorf("expected 0 events for empty correlation id, got %d", timeline.EventCount)
	}
}

func TestDecodeLogsRejectsGarbage(t *testing.T) {
	if _, _, err := DecodeLogs("hello world\nnot json"); err == nil {
		t.Error("expected error for input with no valid JSON")
	}
	if _, _, err := DecodeLogs(""); err == nil {
		t.Error("expected error for empty input")
	}
}

func TestDecodeLogsTrailingCommaLines(t *testing.T) {
	input := `[
  {"ts": 1705316625000, "service": "a", "msg": "one", "request_id": "x-1"},
  {"ts": 1705316625100, "service": "a", "msg": "two", "request_id": "x-1"},
`
	// Truncated array paste: array parse fails, line mode should recover both rows.
	raw, malformed, err := DecodeLogs(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != 2 {
		t.Errorf("expected 2 recovered entries, got %d", len(raw))
	}
	if malformed != 0 {
		t.Errorf("expected 0 malformed, got %d", malformed)
	}
}
