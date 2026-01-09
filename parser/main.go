//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"

	"trace/parser"
)

func main() {
	js.Global().Set("traceParseAndBuild", js.FuncOf(parseAndBuild))
	<-make(chan struct{})
}

func parseAndBuild(_ js.Value, args []js.Value) interface{} {
	logsJSON := args[0].String()
	correlationID := args[1].String()

	rawEntries, malformed, err := parser.DecodeLogs(logsJSON)
	if err != nil {
		out, _ := json.Marshal(map[string]interface{}{
			"timeline": nil,
			"schema":   nil,
			"stats":    nil,
			"error":    err.Error(),
		})
		return string(out)
	}

	raw := toRawEntries(rawEntries)
	schema := parser.InferSchema(raw)
	entries, stats := parser.ParseEntries(rawEntries, schema)
	stats.MalformedLines = malformed
	timeline := parser.BuildTimeline(entries, correlationID)

	out, _ := json.Marshal(map[string]interface{}{
		"timeline": timeline,
		"schema":   schema,
		"stats":    stats,
		"error":    nil,
	})
	return string(out)
}

func toRawEntries(raw []map[string]interface{}) []parser.RawLogEntry {
	entries := make([]parser.RawLogEntry, len(raw))
	for i, fields := range raw {
		entries[i] = parser.RawLogEntry{Fields: fields}
	}
	return entries
}
