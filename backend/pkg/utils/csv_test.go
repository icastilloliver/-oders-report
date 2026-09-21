package utils

import (
	"bytes"
	"testing"
)

// TestCSVStreamWriterMatchesBuildCSV blinda el formato del CSV: la versión
// en streaming (usada para exports grandes) debe producir exactamente los
// mismos bytes que BuildCSV (la referencia original, usada para exports
// chicos), fila por fila, para no romper la apertura en Excel.
func TestCSVStreamWriterMatchesBuildCSV(t *testing.T) {
	cases := []struct {
		name   string
		header []string
		rows   [][]string
	}{
		{
			name:   "simple",
			header: []string{"a", "b", "c"},
			rows: [][]string{
				{"1", "2", "3"},
				{"4", "5", "6"},
			},
		},
		{
			name:   "comillas y comas",
			header: []string{"nombre", "nota"},
			rows: [][]string{
				{`Juan "el rápido"`, "1,2,3"},
			},
		},
		{
			name:   "saltos de línea",
			header: []string{"col"},
			rows: [][]string{
				{"línea1\nlínea2"},
				{"línea1\r\nlínea2"},
			},
		},
		{
			name:   "acentos",
			header: []string{"ciudad"},
			rows: [][]string{
				{"Ciudad de México"},
				{"Querétaro"},
			},
		},
		{
			name:   "celda vacía",
			header: []string{"a", "b"},
			rows: [][]string{
				{"", ""},
				{"x", ""},
			},
		},
		{
			name:   "una sola columna",
			header: []string{"solo"},
			rows: [][]string{
				{"uno"},
				{"dos"},
			},
		},
		{
			name:   "sin filas",
			header: []string{"a", "b"},
			rows:   nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			want := BuildCSV(tc.header, tc.rows)

			var buf bytes.Buffer
			sw := NewCSVStreamWriter(&buf)
			if err := sw.WriteRow(tc.header); err != nil {
				t.Fatalf("WriteRow(header): %v", err)
			}
			for _, row := range tc.rows {
				if err := sw.WriteRow(row); err != nil {
					t.Fatalf("WriteRow(row): %v", err)
				}
			}
			if err := sw.Flush(); err != nil {
				t.Fatalf("Flush: %v", err)
			}

			if got := buf.String(); got != want {
				t.Errorf("CSVStreamWriter output mismatch\ngot:  %q\nwant: %q", got, want)
			}
		})
	}
}

func TestCSVStreamWriterWriteBOM(t *testing.T) {
	var buf bytes.Buffer
	sw := NewCSVStreamWriter(&buf)
	if err := sw.WriteBOM(); err != nil {
		t.Fatalf("WriteBOM: %v", err)
	}
	if err := sw.WriteRow([]string{"a"}); err != nil {
		t.Fatalf("WriteRow: %v", err)
	}
	if err := sw.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	want := CSVBOM + "a"
	if got := buf.String(); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
