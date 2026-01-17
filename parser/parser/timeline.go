package parser

import (
	"sort"
	"strings"
	"time"
)

// A lane whose events sit entirely outside every other lane's time range by
// more than this is flagged as suspected clock skew. Timestamps are never
// rewritten — overlap between concurrent services is normal, and correcting
// skew reliably needs causal instrumentation this tool deliberately avoids.
const skewThresholdMs = 5000

func BuildTimeline(entries []LogEntry, correlationID string) Timeline {
	filtered := make([]LogEntry, 0)
	if correlationID != "" {
		for _, e := range entries {
			if e.CorrelationID == correlationID {
				filtered = append(filtered, e)
			}
		}
	}

	if len(filtered) == 0 {
		return Timeline{
			CorrelationID: correlationID,
			Services:      []ServiceTimeline{},
		}
	}

	byService := map[string][]LogEntry{}
	for _, e := range filtered {
		byService[e.ServiceName] = append(byService[e.ServiceName], e)
	}
	for name := range byService {
		sortEntries(byService[name])
	}

	// Lanes ordered by first activity.
	serviceNames := make([]string, 0, len(byService))
	for name := range byService {
		serviceNames = append(serviceNames, name)
	}
	sort.Slice(serviceNames, func(i, j int) bool {
		a, b := byService[serviceNames[i]][0].Timestamp, byService[serviceNames[j]][0].Timestamp
		if a.Equal(b) {
			return serviceNames[i] < serviceNames[j]
		}
		return a.Before(b)
	})

	suspectedSkew := detectClockSkew(serviceNames, byService)

	var earliest time.Time
	for _, svcEntries := range byService {
		if earliest.IsZero() || svcEntries[0].Timestamp.Before(earliest) {
			earliest = svcEntries[0].Timestamp
		}
	}

	services := make([]ServiceTimeline, 0, len(serviceNames))
	for _, name := range serviceNames {
		svcEntries := byService[name]
		events := make([]TimelineEvent, 0, len(svcEntries))
		hasFailure := false

		for _, e := range svcEntries {
			isFailure := IsFailureEvent(e)
			if isFailure {
				hasFailure = true
			}
			events = append(events, TimelineEvent{
				ServiceName: e.ServiceName,
				Timestamp:   e.Timestamp,
				RelativeMs:  e.Timestamp.Sub(earliest).Milliseconds(),
				Message:     e.Message,
				Level:       e.Level,
				StatusCode:  e.StatusCode,
				LatencyMs:   e.LatencyMs,
				IsFailure:   isFailure,
			})
		}

		services = append(services, ServiceTimeline{
			ServiceName: name,
			Events:      events,
			FirstEvent:  svcEntries[0].Timestamp,
			LastEvent:   svcEntries[len(svcEntries)-1].Timestamp,
			HasFailure:  hasFailure,
		})
	}

	// Global order over pointers into the lanes, so marking last-success
	// updates the lane copy and the summary pointer together.
	allEvents := make([]*TimelineEvent, 0, len(filtered))
	for si := range services {
		for ei := range services[si].Events {
			allEvents = append(allEvents, &services[si].Events[ei])
		}
	}
	sort.SliceStable(allEvents, func(i, j int) bool {
		if allEvents[i].RelativeMs == allEvents[j].RelativeMs {
			return allEvents[i].ServiceName < allEvents[j].ServiceName
		}
		return allEvents[i].RelativeMs < allEvents[j].RelativeMs
	})

	var failurePoint *TimelineEvent
	var lastSuccess *TimelineEvent
	for _, ev := range allEvents {
		if ev.IsFailure {
			failurePoint = ev
			break
		}
		lastSuccess = ev
	}
	if failurePoint == nil {
		lastSuccess = nil
	} else if lastSuccess != nil {
		lastSuccess.IsLastSuccess = true
	}

	return Timeline{
		CorrelationID:   correlationID,
		Services:        services,
		TotalDurationMs: allEvents[len(allEvents)-1].RelativeMs,
		FailurePoint:    failurePoint,
		LastSuccess:     lastSuccess,
		EventCount:      len(allEvents),
		SuspectedSkew:   suspectedSkew,
	}
}

// detectClockSkew flags lanes whose entire activity window is disjoint from
// every other lane's window by more than skewThresholdMs. OffsetMs is the
// estimated minimum clock offset (positive: lane's clock appears ahead).
func detectClockSkew(serviceNames []string, byService map[string][]LogEntry) []SkewWarning {
	if len(serviceNames) < 2 {
		return nil
	}

	warnings := []SkewWarning{}
	for _, name := range serviceNames {
		lane := byService[name]
		laneMin := lane[0].Timestamp
		laneMax := lane[len(lane)-1].Timestamp

		var othersMin, othersMax time.Time
		for _, other := range serviceNames {
			if other == name {
				continue
			}
			o := byService[other]
			if othersMin.IsZero() || o[0].Timestamp.Before(othersMin) {
				othersMin = o[0].Timestamp
			}
			if othersMax.IsZero() || o[len(o)-1].Timestamp.After(othersMax) {
				othersMax = o[len(o)-1].Timestamp
			}
		}

		if gap := laneMin.Sub(othersMax).Milliseconds(); gap > skewThresholdMs {
			warnings = append(warnings, SkewWarning{ServiceName: name, OffsetMs: gap})
		} else if gap := othersMin.Sub(laneMax).Milliseconds(); gap > skewThresholdMs {
			warnings = append(warnings, SkewWarning{ServiceName: name, OffsetMs: -gap})
		}
	}
	if len(warnings) == 0 {
		return nil
	}

	// When every lane is disjoint from every other (typically just two
	// lanes), the gap is real but which clock is wrong is ambiguous — keep
	// only the most suspect lane: fewest events, then a clock running
	// behind (the common NTP failure mode), then name.
	if len(warnings) == len(serviceNames) {
		sort.Slice(warnings, func(i, j int) bool {
			ni, nj := len(byService[warnings[i].ServiceName]), len(byService[warnings[j].ServiceName])
			if ni != nj {
				return ni < nj
			}
			if (warnings[i].OffsetMs < 0) != (warnings[j].OffsetMs < 0) {
				return warnings[i].OffsetMs < 0
			}
			return warnings[i].ServiceName < warnings[j].ServiceName
		})
		warnings = warnings[:1]
	}
	return warnings
}

func sortEntries(entries []LogEntry) {
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Timestamp.Before(entries[j].Timestamp)
	})
}

func IsFailureEvent(entry LogEntry) bool {
	if entry.Level == "error" || entry.Level == "fatal" || entry.Level == "critical" {
		return true
	}
	if entry.StatusCode >= 500 {
		return true
	}
	msg := strings.ToLower(entry.Message)
	failureKeywords := []string{"error", "failed", "exception", "panic", "timeout", "refused"}
	for _, kw := range failureKeywords {
		if strings.Contains(msg, kw) {
			return true
		}
	}
	return false
}
