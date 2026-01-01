package parser

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestMixedServicesTimeline(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "test_logs", "mixed_services_sample.json"))
	if err != nil {
		t.Fatal(err)
	}

	var raw []map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}

	rawEntries := make([]RawLogEntry, len(raw))
	for i, fields := range raw {
		rawEntries[i] = RawLogEntry{Fields: fields}
	}

	schema := InferSchema(rawEntries)
	if schema.CorrelationID == "" {
		t.Error("expected correlation ID field to be inferred")
	}

	entries := ParseEntries(raw, schema)
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

func TestExpressTimeline(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "test_logs", "express_sample.json"))
	if err != nil {
		t.Fatal(err)
	}

	var raw []map[string]interface{}
	json.Unmarshal(data, &raw)

	rawEntries := make([]RawLogEntry, len(raw))
	for i, fields := range raw {
		rawEntries[i] = RawLogEntry{Fields: fields}
	}

	schema := InferSchema(rawEntries)
	entries := ParseEntries(raw, schema)
	timeline := BuildTimeline(entries, "exp-002")

	if timeline.EventCount == 0 {
		t.Fatal("expected events for exp-002")
	}

	if timeline.FailurePoint == nil {
		t.Error("expected failure for exp-002")
	}
}

func TestNoMatchingCorrelationID(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "test_logs", "mixed_services_sample.json"))
	if err != nil {
		t.Fatal(err)
	}

	var raw []map[string]interface{}
	json.Unmarshal(data, &raw)

	rawEntries := make([]RawLogEntry, len(raw))
	for i, fields := range raw {
		rawEntries[i] = RawLogEntry{Fields: fields}
	}

	schema := InferSchema(rawEntries)
	entries := ParseEntries(raw, schema)
	timeline := BuildTimeline(entries, "nonexistent-id")

	if timeline.EventCount != 0 {
		t.Errorf("expected 0 events, got %d", timeline.EventCount)
	}
}
