package middlewares

import "net/http"

func CorsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:5173")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		// El frontend lee Content-Disposition (nombre de archivo) y
		// X-Total-Rows en las descargas de CSV; sin exponerlos, fetch() no
		// puede leerlos en un origen cruzado (mismo motivo que server.js:19).
		w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition, X-Total-Rows, X-Truncated")

		// 4. Handle the browser preflight OPTIONS request
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// 5. Pass down to the actual route handler
		next.ServeHTTP(w, r)
	})
}
