package utils

import (
	"bufio"
	"io"
	"strings"
)

// CSVBOM se antepone al contenido: sin él, Excel en Windows rompe los
// acentos del payload (mismo motivo que el BOM en server.js). Se construye
// a partir del code point porque un BOM literal en el fuente es inválido
// fuera del primer byte del archivo.
var CSVBOM = string(rune(0xFEFF))

// csvSink es lo mínimo que necesita writeCSVRow para escribir una fila.
// Tanto *strings.Builder (usado por BuildCSV) como *bufio.Writer (usado por
// CSVStreamWriter) lo satisfacen, así que ambos caminos comparten el mismo
// escapado sin duplicar lógica.
type csvSink interface {
	io.Writer
	io.ByteWriter
	io.StringWriter
}

// BuildCSV arma un CSV completo en memoria a partir de un encabezado y
// filas ya convertidas a texto. Útil para exports chicos; para resultados
// grandes usa CSVStreamWriter, que no retiene el archivo completo en RAM.
// Se conserva también como referencia de formato: csv_test.go compara su
// salida byte a byte contra CSVStreamWriter para blindar el escapado.
func BuildCSV(header []string, rows [][]string) string {
	var b strings.Builder
	_ = writeCSVRow(&b, header)
	for _, row := range rows {
		b.WriteByte('\n')
		_ = writeCSVRow(&b, row)
	}
	return b.String()
}

// writeCSVRow aplica el mismo escapado que el helper `csvValue` de
// server.js: solo se envuelve en comillas cuando la celda trae comas,
// comillas o saltos de línea, y las comillas internas se duplican.
func writeCSVRow(b csvSink, cells []string) error {
	for i, cell := range cells {
		if i > 0 {
			if err := b.WriteByte(','); err != nil {
				return err
			}
		}
		if _, err := b.WriteString(csvCellValue(cell)); err != nil {
			return err
		}
	}
	return nil
}

func csvCellValue(value string) string {
	escaped := strings.ReplaceAll(value, `"`, `""`)
	if strings.ContainsAny(escaped, `",`+"\n\r") {
		return `"` + escaped + `"`
	}
	return escaped
}

// csvStreamBufSize: 256 KiB. Las filas de estos exports son anchas (algunas
// tablas cargan columnas JSON completas); un buffer chico provocaría
// demasiados writes al socket subyacente.
const csvStreamBufSize = 256 << 10

// CSVStreamWriter escribe un CSV fila por fila directo a un io.Writer (por
// ejemplo el http.ResponseWriter de una descarga), sin acumular el archivo
// completo en memoria como hace BuildCSV. Reproduce el mismo formato byte a
// byte: BOM primero (si se pide), sin salto de línea antes del encabezado,
// '\n' antes de cada fila siguiente, sin salto de línea final.
type CSVStreamWriter struct {
	w        *bufio.Writer
	wroteRow bool
}

// NewCSVStreamWriter envuelve w en un buffer propio; llamar Flush() para
// que los bytes realmente salgan (útil para controlar cuándo el cliente
// empieza a recibir datos en una respuesta HTTP en streaming).
func NewCSVStreamWriter(w io.Writer) *CSVStreamWriter {
	return &CSVStreamWriter{w: bufio.NewWriterSize(w, csvStreamBufSize)}
}

func (c *CSVStreamWriter) WriteBOM() error {
	_, err := c.w.WriteString(CSVBOM)
	return err
}

func (c *CSVStreamWriter) WriteRow(cells []string) error {
	if c.wroteRow {
		if err := c.w.WriteByte('\n'); err != nil {
			return err
		}
	}
	if err := writeCSVRow(c.w, cells); err != nil {
		return err
	}
	c.wroteRow = true
	return nil
}

func (c *CSVStreamWriter) Flush() error {
	return c.w.Flush()
}
