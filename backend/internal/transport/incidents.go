package transport

import (
	"encoding/json"
	"errors"
	"net/http"

	"edd-panel-backend/internal/model"
	"edd-panel-backend/internal/services"
	"edd-panel-backend/pkg/utils"
)

// HandlerIncidents atiende la bitácora de incidencias del tablero:
//   GET    /api/incidents?company&start&end  → lista del rango
//   POST   /api/incidents                    → registra una
//   DELETE /api/incidents?id=                → la elimina
func (h *OrdersHandler) HandlerIncidents(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.handleListIncidents(w, r)
	case http.MethodPost:
		h.handleCreateIncident(w, r)
	case http.MethodPut:
		h.handleUpdateIncident(w, r)
	case http.MethodDelete:
		h.handleDeleteIncident(w, r)
	default:
		w.Header().Set("Allow", "GET, POST, PUT, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *OrdersHandler) handleListIncidents(w http.ResponseWriter, r *http.Request) {
	company := r.URL.Query().Get("company")
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")

	data, err := h.service.ListIncidents(r.Context(), company, start, end)
	if err != nil {
		utils.Logging("ERROR", "Error listing incidents", "", map[string]any{
			"query": r.URL.Query(), "error": err.Error(),
		})
		if errors.Is(err, services.ErrInvalidDateFormat) {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": data})
}

func (h *OrdersHandler) handleCreateIncident(w http.ResponseWriter, r *http.Request) {
	var inc model.Incident
	if err := json.NewDecoder(r.Body).Decode(&inc); err != nil {
		writeJSONError(w, http.StatusBadRequest, services.ErrBulkInvalidBody)
		return
	}

	created, err := h.service.CreateIncident(r.Context(), &inc)
	if err != nil {
		utils.Logging("ERROR", "Error creating incident", "", map[string]any{"error": err.Error()})
		switch {
		case errors.Is(err, services.ErrInvalidDateFormat),
			errors.Is(err, services.ErrIncidentTitulo),
			errors.Is(err, services.ErrIncidentTipo),
			errors.Is(err, services.ErrIncidentRango),
			errors.Is(err, services.ErrIncidentColor),
			errors.Is(err, services.ErrIncidentHoras):
			writeJSONError(w, http.StatusBadRequest, err)
		default:
			writeJSONError(w, http.StatusInternalServerError, err)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(created)
}

func (h *OrdersHandler) handleUpdateIncident(w http.ResponseWriter, r *http.Request) {
	var inc model.Incident
	if err := json.NewDecoder(r.Body).Decode(&inc); err != nil {
		writeJSONError(w, http.StatusBadRequest, services.ErrBulkInvalidBody)
		return
	}

	updated, err := h.service.UpdateIncident(r.Context(), &inc)
	if err != nil {
		utils.Logging("ERROR", "Error updating incident", "", map[string]any{"id": inc.ID, "error": err.Error()})
		switch {
		case errors.Is(err, services.ErrIncidentNotFound):
			writeJSONError(w, http.StatusNotFound, err)
		case errors.Is(err, services.ErrInvalidDateFormat),
			errors.Is(err, services.ErrIncidentID),
			errors.Is(err, services.ErrIncidentTitulo),
			errors.Is(err, services.ErrIncidentTipo),
			errors.Is(err, services.ErrIncidentRango),
			errors.Is(err, services.ErrIncidentColor),
			errors.Is(err, services.ErrIncidentHoras):
			writeJSONError(w, http.StatusBadRequest, err)
		default:
			writeJSONError(w, http.StatusInternalServerError, err)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(updated)
}

func (h *OrdersHandler) handleDeleteIncident(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if err := h.service.DeleteIncident(r.Context(), id); err != nil {
		utils.Logging("ERROR", "Error deleting incident", "", map[string]any{"id": id, "error": err.Error()})
		switch {
		case errors.Is(err, services.ErrIncidentID):
			writeJSONError(w, http.StatusBadRequest, err)
		case errors.Is(err, services.ErrIncidentNotFound):
			writeJSONError(w, http.StatusNotFound, err)
		default:
			writeJSONError(w, http.StatusInternalServerError, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
