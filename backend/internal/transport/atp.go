package transport

import (
	"encoding/json"
	"errors"
	"net/http"

	"edd-panel-backend/internal/model"
	"edd-panel-backend/internal/services"
	"edd-panel-backend/pkg/utils"
)

// Handlers de la vista Validación ATP y de las métricas de error de los
// tabs Decomm (tendencia diaria y comparativa por tipo de surtido).

func (h *OrdersHandler) HandlerAtpDecommRows(w http.ResponseWriter, r *http.Request) {
	h.handleAtpDecommRows(w, r)
}

func (h *OrdersHandler) HandlerAtpValidate(w http.ResponseWriter, r *http.Request) {
	h.handleAtpValidate(w, r)
}

func (h *OrdersHandler) HandlerErrorTrend(w http.ResponseWriter, r *http.Request) {
	h.handleErrorTrend(w, r)
}

func (h *OrdersHandler) HandlerErrorCodesFulfillment(w http.ResponseWriter, r *http.Request) {
	h.handleErrorCodesFulfillment(w, r)
}

func writeJSONError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error()})
}

func (h *OrdersHandler) handleAtpDecommRows(w http.ResponseWriter, r *http.Request) {
	company := r.URL.Query().Get("company")
	fulfillmentType := r.URL.Query().Get("fulfillmentType")
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")

	rows, truncated, err := h.service.GetAtpDecommRows(r.Context(), company, fulfillmentType, startDate, endDate)
	if err != nil {
		utils.Logging("ERROR", "Error getting atp decomm rows", "", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
		})
		switch {
		case errors.Is(err, services.ErrInvalidDateFormat),
			errors.Is(err, services.ErrInvalidCompany),
			errors.Is(err, services.ErrInvalidFulfillmentType):
			writeJSONError(w, http.StatusBadRequest, err)
		default:
			writeJSONError(w, http.StatusInternalServerError, err)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"rows":      rows,
		"total":     len(rows),
		"truncated": truncated,
		"range":     map[string]string{"start": startDate, "end": endDate},
		"company":   company,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (h *OrdersHandler) handleAtpValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// TimeoutSeconds como json.Number: el contrato del Express aceptaba tanto
	// 30 como "30"; si no parsea, 0 deja que el service aplique el default.
	var payload struct {
		Company        string                  `json:"company"`
		TimeoutSeconds json.Number             `json:"timeoutSeconds"`
		Items          []model.AtpValidateItem `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeJSONError(w, http.StatusBadRequest, services.ErrBulkInvalidBody)
		return
	}

	timeoutReq := 0
	if n, err := payload.TimeoutSeconds.Int64(); err == nil {
		timeoutReq = int(n)
	} else if f, err := payload.TimeoutSeconds.Float64(); err == nil {
		timeoutReq = int(f)
	}

	results, timeoutSeconds, err := h.service.ValidateAtp(payload.Company, timeoutReq, payload.Items)
	if err != nil {
		utils.Logging("ERROR", "Error validating atp", "", map[string]any{
			"items": len(payload.Items),
			"error": err.Error(),
		})
		switch {
		case errors.Is(err, services.ErrAtpMissingAuth):
			writeJSONError(w, http.StatusServiceUnavailable, err)
		case errors.Is(err, services.ErrAtpOnlySB),
			errors.Is(err, services.ErrAtpEmptyItems),
			errors.Is(err, services.ErrAtpTooManyItems):
			writeJSONError(w, http.StatusBadRequest, err)
		default:
			writeJSONError(w, http.StatusInternalServerError, err)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"results":        results,
		"timeoutSeconds": timeoutSeconds,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (h *OrdersHandler) handleErrorTrend(w http.ResponseWriter, r *http.Request) {
	company := r.URL.Query().Get("company")
	productType := r.URL.Query().Get("productType")
	fulfillmentType := r.URL.Query().Get("fulfillmentType")
	marketPlace := r.URL.Query().Get("marketPlace")
	channel := r.URL.Query().Get("channel")
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")

	days, codes, err := h.service.GetErrorTrend(r.Context(), company, productType, fulfillmentType, marketPlace, channel, startDate, endDate)
	if err != nil {
		utils.Logging("ERROR", "Error getting error trend", "", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
		})
		switch {
		case errors.Is(err, services.ErrInvalidDateFormat),
			errors.Is(err, services.ErrInvalidFulfillmentType),
			errors.Is(err, services.ErrInvalidMarketPlace),
			errors.Is(err, services.ErrInvalidChannel):
			writeJSONError(w, http.StatusBadRequest, err)
		default:
			writeJSONError(w, http.StatusInternalServerError, err)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"days":    days,
		"codes":   codes,
		"range":   map[string]string{"start": startDate, "end": endDate},
		"company": company,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (h *OrdersHandler) handleErrorCodesFulfillment(w http.ResponseWriter, r *http.Request) {
	company := r.URL.Query().Get("company")
	marketPlace := r.URL.Query().Get("marketPlace")
	channel := r.URL.Query().Get("channel")
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")

	segments, err := h.service.GetErrorCodesFulfillment(r.Context(), company, marketPlace, channel, startDate, endDate)
	if err != nil {
		utils.Logging("ERROR", "Error getting error codes fulfillment", "", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
		})
		switch {
		case errors.Is(err, services.ErrInvalidDateFormat),
			errors.Is(err, services.ErrInvalidMarketPlace),
			errors.Is(err, services.ErrInvalidChannel):
			writeJSONError(w, http.StatusBadRequest, err)
		default:
			writeJSONError(w, http.StatusInternalServerError, err)
		}
		return
	}

	var mp interface{}
	if marketPlace != "" {
		mp = marketPlace
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"segments":    segments,
		"range":       map[string]string{"start": startDate, "end": endDate},
		"company":     company,
		"marketPlace": mp,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (h *OrdersHandler) HandlerChannelBreakdown(w http.ResponseWriter, r *http.Request) {
	company := r.URL.Query().Get("company")
	productType := r.URL.Query().Get("productType")
	fulfillmentType := r.URL.Query().Get("fulfillmentType")
	marketPlace := r.URL.Query().Get("marketPlace")
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")

	data, err := h.service.GetChannelBreakdown(r.Context(), company, productType, fulfillmentType, marketPlace, startDate, endDate)
	if err != nil {
		utils.Logging("ERROR", "Error getting channel breakdown", "", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
		})
		switch {
		case errors.Is(err, services.ErrInvalidDateFormat),
			errors.Is(err, services.ErrInvalidFulfillmentType),
			errors.Is(err, services.ErrInvalidMarketPlace):
			writeJSONError(w, http.StatusBadRequest, err)
		default:
			writeJSONError(w, http.StatusInternalServerError, err)
		}
		return
	}

	var total int64
	for _, c := range data {
		total += c.Total
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"data":    data,
		"total":   total,
		"range":   map[string]string{"start": startDate, "end": endDate},
		"company": company,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
