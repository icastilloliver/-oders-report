package middlewares

import (
	"bytes"
	"edd-panel-backend/pkg/utils"
	"io"
	"net/http"
)

func RequestInterceptor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload any
		if r.Method == http.MethodGet {
			payload = r.URL.Query()
		} else {
			body, err := io.ReadAll(r.Body)
			if err == nil {
				r.Body = io.NopCloser(bytes.NewBuffer(body))
				payload = string(body)
			}
		}

		utils.Logging("INFO", "Request received", r.URL.Path, payload)

		next.ServeHTTP(w, r)
	})
}
