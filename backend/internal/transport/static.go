package transport

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// NewStaticHandler sirve los archivos estáticos del frontend ya compilado
// (frontend/dist) y, para cualquier ruta que no exista como archivo y no
// empiece con /api/, regresa index.html — así refrescar la página en
// cualquier vista del dashboard (o entrar directo a una URL) no da 404,
// igual que el catch-all que tenía server.js con express.static.
//
// A diferencia de aquel catch-all, una ruta /api/* que no matchea ninguna
// ruta registrada responde 404 normal en vez del HTML de la SPA.
func NewStaticHandler(distDir string) http.Handler {
	fileServer := http.FileServer(http.Dir(distDir))
	indexPath := filepath.Join(distDir, "index.html")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		path := filepath.Join(distDir, filepath.Clean(r.URL.Path))
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			http.ServeFile(w, r, indexPath)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}
