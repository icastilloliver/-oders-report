package transport

import (
	"edd-panel-backend/internal/services"
	"edd-panel-backend/pkg/utils"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

type OrdersHandler struct {
	service *services.OrdersService
}

func NewOrdersHandler(service *services.OrdersService) *OrdersHandler {
	return &OrdersHandler{
		service: service,
	}
}

func (h *OrdersHandler) HandlerOrdersSummary(w http.ResponseWriter, r *http.Request) {
	h.handleGetOrdersSummary(w, r)
}

func (h *OrdersHandler) HandlerRecalculateOrders(w http.ResponseWriter, r *http.Request) {
	h.handleRecalculateOrders(w, r)
}

func (h *OrdersHandler) HandlerDeliveryTypes(w http.ResponseWriter, r *http.Request) {
	h.handleGetDeliveryTypes(w, r)
}

func (h *OrdersHandler) HandlerOrderSearch(w http.ResponseWriter, r *http.Request) {
	h.handleOrderSearch(w, r)
}

func (h *OrdersHandler) HandlerOrdersCSV(w http.ResponseWriter, r *http.Request) {
	h.handleOrdersCSV(w, r)
}

func (h *OrdersHandler) HandlerErrorCodes(w http.ResponseWriter, r *http.Request) {
	h.handleGetErrorCodes(w, r)
}

func (h *OrdersHandler) HandlerOrdersBulkCheck(w http.ResponseWriter, r *http.Request) {
	h.handleOrdersBulkCheck(w, r)
}

func (h *OrdersHandler) HandlerErrorCodesCSV(w http.ResponseWriter, r *http.Request) {
	h.handleGetErrorCodesCSV(w, r)
}

func (h *OrdersHandler) handleGetOrdersSummary(w http.ResponseWriter, r *http.Request) {
	// Implement the logic to handle GET request for orders summary
	productType := r.URL.Query().Get("productType")
	fulfillmentType := r.URL.Query().Get("fulfillmentType")
	marketplace := r.URL.Query().Get("marketPlace")
	channel := r.URL.Query().Get("channel")
	hourStart := r.URL.Query().Get("hourStart")
	hourEnd := r.URL.Query().Get("hourEnd")
	company := r.URL.Query().Get("company")
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")

	summary, err := h.service.GetOrdersSummary(productType, fulfillmentType, marketplace, channel, hourStart, hourEnd, company, startDate, endDate)
	if err != nil {
		utils.Logging("ERROR", "Error getting orders summary", "", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
		})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "bad_request",
			"message": fmt.Sprintf("Error getting orders summary: %v", err),
		})
		return
	}

	// Respond with the orders summary in JSON format
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"data": summary,
		"range": map[string]string{
			"start": startDate,
			"end":   endDate,
		},
		"company":     company,
		"productType": productType,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (h *OrdersHandler) handleRecalculateOrders(w http.ResponseWriter, r *http.Request) {
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")
	company := r.URL.Query().Get("company")

	summary, err := h.service.RecalculateOrders(startDate, endDate, company)
	if err != nil {
		utils.Logging("ERROR", "Error getting recalculated orders summary", "", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
		})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "bad_request",
			"message": fmt.Sprintf("Error getting recalculated orders summary: %v", err),
		})
		return
	}

	// Respond with the orders summary in JSON format
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"data": summary,
		"range": map[string]string{
			"start": startDate,
			"end":   endDate,
		},
		"company": company,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (h *OrdersHandler) handleGetDeliveryTypes(w http.ResponseWriter, r *http.Request) {
	company := r.URL.Query().Get("company")
	productType := r.URL.Query().Get("productType")
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")

	result, err := h.service.GetDeliveryTypes(company, productType, startDate, endDate)
	if err != nil {
		utils.Logging("ERROR", "Error getting delivery types", "", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
		})
		w.Header().Set("Content-Type", "application/json")
		if errors.Is(err, services.ErrInvalidDateFormat) {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"error": err.Error(),
			})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"byDay":  result.ByDay,
		"stores": result.Stores,
		"totals": result.Totals,
		"range": map[string]string{
			"start": startDate,
			"end":   endDate,
		},
		"company":     company,
		"productType": productType,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (h *OrdersHandler) handleGetErrorCodes(w http.ResponseWriter, r *http.Request) {
	company := r.URL.Query().Get("company")
	productType := r.URL.Query().Get("productType")
	fulfillmentType := r.URL.Query().Get("fulfillmentType")
	marketPlace := r.URL.Query().Get("marketPlace")
	channel := r.URL.Query().Get("channel")
	hourStart := r.URL.Query().Get("hourStart")
	hourEnd := r.URL.Query().Get("hourEnd")
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")

	result, err := h.service.GetErrorCodes(company, productType, fulfillmentType, marketPlace, channel, startDate, endDate, hourStart, hourEnd)
	if err != nil {
		utils.Logging("ERROR", "Error getting error codes", "", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
		})
		w.Header().Set("Content-Type", "application/json")
		if errors.Is(err, services.ErrInvalidDateFormat) ||
			errors.Is(err, services.ErrInvalidFulfillmentType) ||
			errors.Is(err, services.ErrInvalidMarketPlace) ||
			errors.Is(err, services.ErrInvalidChannel) ||
			errors.Is(err, services.ErrInvalidHourRange) {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"error": err.Error(),
			})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"data":  result.Data,
		"total": result.Total,
		"range": map[string]string{
			"start": startDate,
			"end":   endDate,
		},
		"company":     company,
		"productType": productType,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (h *OrdersHandler) handleOrderSearch(w http.ResponseWriter, r *http.Request) {
	orderNumber := strings.TrimSpace(r.URL.Query().Get("orderNumber"))
	sku := strings.TrimSpace(r.URL.Query().Get("sku"))
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")

	lines, truncated, err := h.service.SearchOrder(orderNumber, sku, start, end)
	if err != nil {
		utils.Logging("ERROR", "Error searching order", "", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
		})
		w.Header().Set("Content-Type", "application/json")
		if errors.Is(err, services.ErrInvalidOrderNumber) ||
			errors.Is(err, services.ErrInvalidSku) ||
			errors.Is(err, services.ErrSearchMissingQuery) ||
			errors.Is(err, services.ErrSearchDatesPair) ||
			errors.Is(err, services.ErrInvalidDateFormat) {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"error": err.Error(),
			})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"orderNumber": orderNumber,
		"sku":         sku,
		"found":       len(lines) > 0,
		"truncated":   truncated,
		"lines":       lines,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (h *OrdersHandler) handleOrdersCSV(w http.ResponseWriter, r *http.Request) {
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")
	company := r.URL.Query().Get("company")
	csvType := r.URL.Query().Get("type")
	productType := r.URL.Query().Get("productType")
	fulfillmentType := r.URL.Query().Get("fulfillmentType")
	marketPlace := r.URL.Query().Get("marketPlace")
	channel := r.URL.Query().Get("channel")
	hourStart := r.URL.Query().Get("hourStart")
	hourEnd := r.URL.Query().Get("hourEnd")

	stream, filename, err := h.service.ExportOrdersCSV(r.Context(), start, end, company, csvType, productType, fulfillmentType, marketPlace, channel, hourStart, hourEnd)
	if err != nil {
		utils.Logging("ERROR", "Error exporting orders csv", "", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
		})
		switch {
		case errors.Is(err, services.ErrMissingCSVParams),
			errors.Is(err, services.ErrInvalidFulfillmentType),
			errors.Is(err, services.ErrInvalidMarketPlace),
			errors.Is(err, services.ErrInvalidChannel),
			errors.Is(err, services.ErrInvalidHourRange),
			errors.Is(err, services.ErrInvalidCSVType):
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"error": err.Error(),
			})
		case errors.Is(err, services.ErrNoCSVRows):
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte("No se encontraron registros de Error o Plan B para este rango."))
		default:
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte("Error generando CSV: " + err.Error()))
		}
		return
	}

	// A partir de aquí ya sabemos que hay al menos una fila (stream.Empty()
	// se descartó en el service), así que es seguro comprometer la
	// respuesta y empezar a transmitir sin acumular el CSV completo en
	// memoria.
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	if total := stream.TotalRows(); total > 0 {
		w.Header().Set("X-Total-Rows", strconv.FormatUint(total, 10))
	}
	w.WriteHeader(http.StatusOK)

	csvw := utils.NewCSVStreamWriter(w)
	flusher, _ := w.(http.Flusher)
	flush := func() {
		_ = csvw.Flush()
		if flusher != nil {
			flusher.Flush()
		}
	}

	_ = csvw.WriteBOM()
	_ = csvw.WriteRow(stream.Header())
	flush()

	for stream.Next() {
		if err := csvw.WriteRow(stream.Row()); err != nil {
			// El cliente cortó la descarga a medias: no es una falla del
			// servidor, solo se deja de escribir.
			utils.Logging("INFO", "Orders CSV download aborted by client", "/api/orders-csv", map[string]any{
				"query": r.URL.Query(),
				"rows":  stream.RowsRead(),
			})
			return
		}
		if stream.AtPageBoundary() {
			flush()
		}
	}

	if err := stream.Err(); err != nil {
		// Ya se mandó el status 200 y bytes al cliente: no se puede
		// regresar un 500 limpio. Se corta la conexión para que el
		// navegador vea una descarga incompleta en vez de un CSV truncado
		// que aparenta estar completo.
		utils.Logging("ERROR", "Error streaming orders csv mid-export", "/api/orders-csv", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
			"rows":  stream.RowsRead(),
		})
		flush()
		panic(http.ErrAbortHandler)
	}

	flush()

	utils.Logging("INFO", "Orders CSV export completed", "/api/orders-csv", map[string]any{
		"query":     r.URL.Query(),
		"rows":      stream.RowsRead(),
		"totalRows": stream.TotalRows(),
	})
}

func (h *OrdersHandler) handleOrdersBulkCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload struct {
		OrderNumbers []string `json:"orderNumbers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		utils.Logging("ERROR", "Error decoding bulk check body", "", map[string]any{
			"error": err.Error(),
		})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error": services.ErrBulkInvalidBody.Error(),
		})
		return
	}

	result, err := h.service.BulkCheckOrders(r.Context(), payload.OrderNumbers)
	if err != nil {
		utils.Logging("ERROR", "Error running bulk check", "", map[string]any{
			"count": len(payload.OrderNumbers),
			"error": err.Error(),
		})
		w.Header().Set("Content-Type", "application/json")
		switch {
		case errors.Is(err, services.ErrBulkEmptyBody),
			errors.Is(err, services.ErrBulkNoValidIDs),
			errors.Is(err, services.ErrBulkBatchTooLarge):
			w.WriteHeader(http.StatusBadRequest)
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(result); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (h *OrdersHandler) handleGetErrorCodesCSV(w http.ResponseWriter, r *http.Request) {
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")
	company := r.URL.Query().Get("company")
	productType := r.URL.Query().Get("productType")
	fulfillmentType := r.URL.Query().Get("fulfillmentType")
	marketPlace := r.URL.Query().Get("marketPlace")
	channel := r.URL.Query().Get("channel")
	hourStart := r.URL.Query().Get("hourStart")
	hourEnd := r.URL.Query().Get("hourEnd")
	codes := r.URL.Query().Get("codes")
	label := r.URL.Query().Get("label")

	header, rows, truncated, filename, err := h.service.GetErrorCodesCSV(
		r.Context(), start, end, company, productType, fulfillmentType, marketPlace, channel, hourStart, hourEnd, codes, label,
	)
	if err != nil {
		utils.Logging("ERROR", "Error exporting error codes csv", "", map[string]any{
			"query": r.URL.Query(),
			"error": err.Error(),
		})
		switch {
		case errors.Is(err, services.ErrInvalidDateFormat),
			errors.Is(err, services.ErrInvalidFulfillmentType),
			errors.Is(err, services.ErrInvalidMarketPlace),
			errors.Is(err, services.ErrInvalidChannel),
			errors.Is(err, services.ErrInvalidHourRange),
			errors.Is(err, services.ErrCodesEmpty),
			errors.Is(err, services.ErrTooManyCodes),
			errors.Is(err, services.ErrCodeTooLong):
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(err.Error()))
		case errors.Is(err, services.ErrNoErrorCodesRows):
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(err.Error()))
		default:
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte("Error generando CSV: " + err.Error()))
		}
		return
	}

	csvBody := utils.CSVBOM + utils.BuildCSV(header, rows)

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("X-Total-Rows", strconv.Itoa(len(rows)))
	w.Header().Set("X-Truncated", strconv.FormatBool(truncated))
	_, _ = w.Write([]byte(csvBody))
}
