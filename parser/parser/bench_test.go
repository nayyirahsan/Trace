package parser

import (
	"fmt"
	"math/rand"
	"testing"
)

// Synthesizes a 10,000-entry multi-service dump with mixed field
// conventions, then measures the full pipeline: schema inference,
// entry parsing, timeline build. README quotes this number.
func BenchmarkFullPipeline10k(b *testing.B) {
	raw := syntheticDump(10000)
	rawEntries := toRaw(raw)
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		schema := InferSchema(rawEntries)
		entries, _ := ParseEntries(raw, schema)
		BuildTimeline(entries, "bench-target-1")
	}
}

func syntheticDump(n int) []map[string]interface{} {
	rng := rand.New(rand.NewSource(42))
	type svc struct{ name, idField, tsField, msgField, lvlField string }
	services := []svc{
		{"api-gateway", "request_id", "ts", "msg", "level"},
		{"auth-service", "req_id", "timestamp", "message", "level"},
		{"order-service", "request_id", "ts", "msg", "level"},
		{"billing", "traceId", "time", "text", "severity"},
		{"inventory", "request_id", "ts", "msg", "level"},
	}
	base := int64(1719849600000)
	out := make([]map[string]interface{}, 0, n)
	for i := 0; i < n; i++ {
		s := services[rng.Intn(len(services))]
		id := fmt.Sprintf("req-%d", rng.Intn(2000))
		if i%167 == 0 {
			id = "bench-target-1"
		}
		svcField := "service"
		if s.idField == "req_id" {
			svcField = "app"
		} else if s.idField == "traceId" {
			svcField = "component"
		}
		out = append(out, map[string]interface{}{
			s.idField:    id,
			s.tsField:    float64(base + int64(i*3)),
			svcField:     s.name,
			s.msgField:   fmt.Sprintf("processed step %d", i),
			s.lvlField:   "info",
			"latency_ms": float64(rng.Intn(200) + 1),
		})
	}
	return out
}
