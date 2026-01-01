package parser

import "time"

type RawLogEntry struct {
	Fields map[string]interface{}
}

type SchemaMap struct {
	CorrelationID string `json:"correlationId"`
	Timestamp     string `json:"timestamp"`
	ServiceName   string `json:"serviceName"`
	Message       string `json:"message"`
	Level         string `json:"level"`
	StatusCode    string `json:"statusCode"`
	LatencyMs     string `json:"latencyMs"`
}

type LogEntry struct {
	CorrelationID string
	Timestamp     time.Time
	ServiceName   string
	Message       string
	Level         string
	StatusCode    int
	LatencyMs     int
	RawFields     map[string]interface{}
}

type TimelineEvent struct {
	ServiceName   string    `json:"serviceName"`
	Timestamp     time.Time `json:"timestamp"`
	RelativeMs    int64     `json:"relativeMs"`
	Message       string    `json:"message"`
	Level         string    `json:"level"`
	StatusCode    int       `json:"statusCode"`
	LatencyMs     int       `json:"latencyMs"`
	IsFailure     bool      `json:"isFailure"`
	IsLastSuccess bool      `json:"isLastSuccess"`
}

type ServiceTimeline struct {
	ServiceName string          `json:"serviceName"`
	Events      []TimelineEvent `json:"events"`
	FirstEvent  time.Time       `json:"firstEvent"`
	LastEvent   time.Time       `json:"lastEvent"`
	HasFailure  bool            `json:"hasFailure"`
}

type Timeline struct {
	CorrelationID   string            `json:"correlationId"`
	Services        []ServiceTimeline `json:"services"`
	TotalDurationMs int64             `json:"totalDurationMs"`
	FailurePoint    *TimelineEvent    `json:"failurePoint"`
	LastSuccess     *TimelineEvent    `json:"lastSuccess"`
	EventCount      int               `json:"eventCount"`
}
