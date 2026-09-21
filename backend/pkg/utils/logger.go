package utils

import (
	"encoding/json"
	"fmt"
	"os"
)

type LogEntry struct {
	Severity string `json:"severity"`
	Event    string `json:"event"`
	Payload  any    `json:"payload"`
	Source   string `json:"source"`
}

func Logging(severity, event, source string, payload any) {
	logEntry := LogEntry{
		Severity: severity,
		Event:    event,
		Payload:  payload,
		Source:   source,
	}

	logJson, err := json.Marshal(logEntry)
	if err != nil {
		fmt.Fprintf(os.Stderr, `{"severity":"ERROR","event":"Failed to marshal log: %v"}`+"\n", err)
		return
	}

	// INFO and standard logs go to stdout
	if severity == "ERROR" {
		fmt.Fprintln(os.Stderr, string(logJson))
	} else {
		fmt.Fprintln(os.Stdout, string(logJson))
	}
}
