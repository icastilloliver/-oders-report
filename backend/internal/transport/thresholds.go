package transport

import (
	"encoding/json"
	"errors"
	"net/http"

	"edd-panel-backend/internal/model"
	"edd-panel-backend/internal/services"
	"edd-panel-backend/pkg/utils"
)

// HandlerThresholds atiende la configuración de umbrales de alertamiento:
//   GET /api/thresholds?company=  → configuración actual ({"data": null} si no hay)
//   PUT /api/thresholds           → guarda o actualiza (upsert por compañía)
func (h *OrdersHandler) HandlerThresholds(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.handleGetThresholds(w, r)
	case http.MethodPut, http.MethodPost:
		h.handleSaveThresholds(w, r)
	default:
		w.Header().Set("Allow", "GET, POST, PUT")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *OrdersHandler) handleGetThresholds(w http.ResponseWriter, r *http.Request) {
	data, err := h.service.GetThresholds(r.Context(), r.URL.Query().Get("company"))
	if err != nil {
		utils.Logging("ERROR", "Error getting thresholds", "", map[string]any{
			"query": r.URL.Query(), "error": err.Error(),
		})
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": data})
}

func (h *OrdersHandler) handleSaveThresholds(w http.ResponseWriter, r *http.Request) {
	var t model.Thresholds
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		writeJSONError(w, http.StatusBadRequest, services.ErrBulkInvalidBody)
		return
	}

	saved, err := h.service.SaveThresholds(r.Context(), &t)
	if err != nil {
		utils.Logging("ERROR", "Error saving thresholds", "", map[string]any{"error": err.Error()})
		switch {
		case errors.Is(err, services.ErrThresholdRango),
			errors.Is(err, services.ErrThresholdVacio):
			writeJSONError(w, http.StatusBadRequest, err)
		default:
			writeJSONError(w, http.StatusInternalServerError, err)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": saved})
}
