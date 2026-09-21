package middlewares

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

// gzipWriterPool evita pagar la asignación (~800 KB de estado de deflate)
// de un *gzip.Writer nuevo en cada request: el middleware es global, así
// que corre en todos los endpoints.
var gzipWriterPool = sync.Pool{
	New: func() any {
		gz, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return gz
	},
}

// gzipResponseWriter envuelve un http.ResponseWriter para comprimir todo lo
// que se le escriba. Implementa Flush para que las respuestas en streaming
// (como el export de CSV) sigan entregando bytes de forma progresiva en vez
// de quedarse atoradas en la ventana de 32 KiB de deflate hasta el cierre.
type gzipResponseWriter struct {
	http.ResponseWriter
	gz *gzip.Writer
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	return g.gz.Write(b)
}

func (g *gzipResponseWriter) Flush() {
	_ = g.gz.Flush()
	if f, ok := g.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap sigue la convención de http.ResponseController (Go 1.20+) para
// llegar al ResponseWriter original si algún handler lo necesita.
func (g *gzipResponseWriter) Unwrap() http.ResponseWriter {
	return g.ResponseWriter
}

// GzipMiddleware comprime la respuesta cuando el cliente anuncia soporte
// para gzip (Accept-Encoding). Se aplica de forma global: no solo el export
// de CSV se beneficia, las respuestas JSON de los demás endpoints también.
// Nivel BestSpeed porque para archivos grandes el cuello de botella pasa a
// ser CPU de deflate, no la relación de compresión.
func GzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Vary", "Accept-Encoding")

		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Del("Content-Length")

		gz := gzipWriterPool.Get().(*gzip.Writer)
		gz.Reset(w)
		defer func() {
			_ = gz.Close()
			gzipWriterPool.Put(gz)
		}()

		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, gz: gz}, r)
	})
}
