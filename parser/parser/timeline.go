package parser

import (
	"sort"
	"strings"
	"time"
)

func BuildTimeline(entries []LogEntry, correlationID string) Timeline {
	filtered := make([]LogEntry, 0)
	for _, e := range entries {
		if e.CorrelationID == correlationID {
			filtered = append(filtered, e)
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

	serviceNames := make([]string, 0, len(byService))
	for name := range byService {
		serviceNames = append(serviceNames, name)
	}
	sort.Slice(serviceNames, func(i, j int) bool {
		sortEntries(byService[serviceNames[i]])
		sortEntries(byService[serviceNames[j]])
		return byService[serviceNames[i]][0].Timestamp.Before(byService[serviceNames[j]][0].Timestamp)
	})

	// Apply clock skew adjustments per service (compare raw timestamps to avoid cascade)
	adjusted := make([][]LogEntry, 0, len(serviceNames))
	var prevRawLast time.Time
	for i, name := range serviceNames {
		svcEntries := make([]LogEntry, len(byService[name]))
		copy(svcEntries, byService[name])
		sortEntries(svcEntries)

		if i > 0 && !prevRawLast.IsZero() {
			first := svcEntries[0].Timestamp
			// B's first event before A's last by >100ms → shift B forward
			if first.Before(prevRawLast) && prevRawLast.Sub(first) > 100*time.Millisecond {
				offset := prevRawLast.Sub(first) + time.Millisecond
				for j := range svcEntries {
					svcEntries[j].Timestamp = svcEntries[j].Timestamp.Add(offset)
				}
			}
		}

		// Track raw (pre-adjustment) last timestamp for next comparison
		rawLast := byService[name]
		sortEntries(rawLast)
		prevRawLast = rawLast[len(rawLast)-1].Timestamp
		adjusted = append(adjusted, svcEntries)
	}

	// Find global earliest timestamp
	var earliest time.Time
	for _, svcEntries := range adjusted {
		for _, e := range svcEntries {
			if earliest.IsZero() || e.Timestamp.Before(earliest) {
				earliest = e.Timestamp
			}
		}
	}

	var allEvents []TimelineEvent
	services := make([]ServiceTimeline, 0, len(adjusted))

	for _, svcEntries := range adjusted {
		if len(svcEntries) == 0 {
			continue
		}

		events := make([]TimelineEvent, 0, len(svcEntries))
		hasFailure := false

		for _, e := range svcEntries {
			relativeMs := e.Timestamp.Sub(earliest).Milliseconds()
			isFailure := IsFailureEvent(e)
			if isFailure {
				hasFailure = true
			}

			events = append(events, TimelineEvent{
				ServiceName:   e.ServiceName,
				Timestamp:     e.Timestamp,
				RelativeMs:    relativeMs,
				Message:       e.Message,
				Level:         e.Level,
				StatusCode:    e.StatusCode,
				LatencyMs:     e.LatencyMs,
				IsFailure:     isFailure,
				IsLastSuccess: false,
			})
			allEvents = append(allEvents, events[len(events)-1])
		}

		services = append(services, ServiceTimeline{
			ServiceName: svcEntries[0].ServiceName,
			Events:      events,
			FirstEvent:  svcEntries[0].Timestamp,
			LastEvent:   svcEntries[len(svcEntries)-1].Timestamp,
			HasFailure:  hasFailure,
		})
	}

	sort.Slice(allEvents, func(i, j int) bool {
		if allEvents[i].RelativeMs == allEvents[j].RelativeMs {
			return allEvents[i].ServiceName < allEvents[j].ServiceName
		}
		return allEvents[i].RelativeMs < allEvents[j].RelativeMs
	})

	var failurePoint *TimelineEvent
	var lastSuccess *TimelineEvent

	for i := range allEvents {
		if allEvents[i].IsFailure && failurePoint == nil {
			failurePoint = &allEvents[i]
			break
		}
	}

	if failurePoint != nil {
		var best *TimelineEvent
		for i := range allEvents {
			if allEvents[i].IsFailure {
				break
			}
			if !allEvents[i].IsFailure {
				best = &allEvents[i]
			}
		}
		// Find highest RelativeMs non-failure before first failure
		for i := range allEvents {
			if allEvents[i].RelativeMs >= failurePoint.RelativeMs {
				break
			}
			if !allEvents[i].IsFailure {
				if best == nil || allEvents[i].RelativeMs > best.RelativeMs {
					best = &allEvents[i]
				}
			}
		}
		lastSuccess = best

		if lastSuccess != nil {
			for si := range services {
				for ei := range services[si].Events {
					if services[si].Events[ei].RelativeMs == lastSuccess.RelativeMs &&
						services[si].Events[ei].ServiceName == lastSuccess.ServiceName &&
						services[si].Events[ei].Message == lastSuccess.Message {
						services[si].Events[ei].IsLastSuccess = true
						*lastSuccess = services[si].Events[ei]
					}
				}
			}
			for i := range allEvents {
				if allEvents[i].RelativeMs == lastSuccess.RelativeMs &&
					allEvents[i].ServiceName == lastSuccess.ServiceName &&
					allEvents[i].Message == lastSuccess.Message {
					allEvents[i].IsLastSuccess = true
					break
				}
			}
		}

		for i := range allEvents {
			if allEvents[i].RelativeMs == failurePoint.RelativeMs &&
				allEvents[i].ServiceName == failurePoint.ServiceName &&
				allEvents[i].Message == failurePoint.Message {
				failurePoint = &allEvents[i]
				break
			}
		}
	}

	var totalDuration int64
	if len(allEvents) > 0 {
		totalDuration = allEvents[len(allEvents)-1].RelativeMs
	}

	return Timeline{
		CorrelationID:   correlationID,
		Services:        services,
		TotalDurationMs: totalDuration,
		FailurePoint:    failurePoint,
		LastSuccess:     lastSuccess,
		EventCount:      len(allEvents),
	}
}

func sortEntries(entries []LogEntry) {
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Timestamp.Before(entries[j].Timestamp)
	})
}

func IsFailureEvent(entry LogEntry) bool {
	if entry.Level == "error" || entry.Level == "fatal" {
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
