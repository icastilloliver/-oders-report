package services

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"edd-panel-backend/internal/model"
	"edd-panel-backend/internal/repository"
)

// La validación ATP consulta EPLInventoryAvailabilityWebService en el OMS de
// Suburbia (envoltorio del API core `promise` de Sterling). SOLO existe para
// Suburbia, y oms.suburbia.com.mx solo resuelve dentro de la red
// corporativa/VPN: fuera de ella la llamada muere en DNS (DNS_NO_ROUTE).
const (
	atpDefaultURL = "https://oms.suburbia.com.mx/smcfs/restapi/executeFlow/EPLInventoryAvailabilityWebService"
	// AtpMaxItems limita los items por petición (el frontend manda lotes de 10).
	AtpMaxItems       = 20
	atpConcurrency    = 5
	atpTimeoutDefault = 20
	atpTimeoutMin     = 5
	atpTimeoutMax     = 60
)

// Sentinels de la validación ATP: el transport los mapea a 400/503.
var (
	ErrAtpOnlySB       = errors.New("la validación ATP usa el OMS de Suburbia (EPLInventoryAvailabilityWebService): solo aplica a SBB Decomm")
	ErrAtpEmptyItems   = errors.New("envía un arreglo items con al menos un elemento")
	ErrAtpTooManyItems = fmt.Errorf("máximo %d items por petición. Divide el lote", AtpMaxItems)
	ErrAtpMissingAuth  = errors.New("falta OMS_ATP_AUTH en backend/.env (credencial Basic del OMS de Suburbia)")
	ErrInvalidCompany  = errors.New("company inválida")
	ErrInvalidChannel  = errors.New("channel inválido")
	ErrInvalidHourRange = errors.New("rango de hora inválido (hourStart y hourEnd en pareja, 0-23)")
)

var (
	atpSkuRegex = regexp.MustCompile(`^[A-Za-z0-9]{4,20}$`)
	atpZipRegex = regexp.MustCompile(`^\d{4,5}$`)

	atpNodeMsgRegex   = regexp.MustCompile(`capacity for node is available`)
	atpHasOptionRegex = regexp.MustCompile(`(?s)<SuggestedOption>.*?<Option[\s>]`)
	atpAssignTagRegex = regexp.MustCompile(`<Assignment\b[^>]*>`)
	atpOptionTagRegex = regexp.MustCompile(`<Option\b[^>]*>`)
	atpErrorTagRegex  = regexp.MustCompile(`<Error\b[^>]*>`)

	atpShipNodeAttr  = regexp.MustCompile(`\bShipNode="([^"]*)"`)
	atpDeliveryAttr  = regexp.MustCompile(`\bDeliveryDate="([^"]*)"`)
	atpFirstDateAttr = regexp.MustCompile(`\bFirstDate="([^"]*)"`)
	atpErrCodeAttr   = regexp.MustCompile(`\bErrorCode="([^"]*)"`)
	atpErrDescAttr   = regexp.MustCompile(`\bErrorDescription="([^"]*)"`)

	atpCompanyRegex = regexp.MustCompile(`^[A-Z]{2,4}$`)
	channelRegex    = regexp.MustCompile(`^[A-Za-z]{2,10}$`)
	dateOnlyRegex   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// Cliente compartido (keep-alive); el timeout por llamada va en el context.
var atpHTTPClient = &http.Client{}

func xmlEscape(s string) string {
	return strings.NewReplacer(
		"&", "&amp;", "<", "&lt;", ">", "&gt;", "'", "&apos;", `"`, "&quot;",
	).Replace(s)
}

func atpPromiseXML(sku, quantity, zipCode string) string {
	return fmt.Sprintf(`<Promise
        AllocationRuleID="EPLSCHRULE"
        OrganizationCode="SUBURBIA"
        >
    <ShipToAddress ZipCode="%s" Country="MX" />
    <PromiseLines>
        <PromiseLine
            CarrierServiceCode="SUBGROUNDSL"
            DeliveryMethod="SHP"
            ShipNode=""
            FulfillmentType="SHIP"
            ItemID="%s"
            LineId="1"
            RequiredQty="%s"
            ProductClass="GOOD"
            UnitOfMeasure="PI"
            ReqStartDate=""
            ExtnNoSpotService=""
            ExtnItemType=""
            ItemType="SL"
        />
    </PromiseLines>
</Promise>`, xmlEscape(zipCode), xmlEscape(sku), xmlEscape(quantity))
}

func firstMatch(re *regexp.Regexp, s string) string {
	if m := re.FindStringSubmatch(s); m != nil {
		return m[1]
	}
	return ""
}

// classifyAtp interpreta la respuesta XML de Sterling. El error
// NOT_ENOUGH_PRODUCT_CHOICES NO llega como <Errors>: viene en HTTP 200
// dentro de <UnavailableLine UnavailableReason="…"> después de que el motor
// agota la lista de nodos (por eso esas respuestas tardan 15-20 s).
func classifyAtp(body string, result *model.AtpValidateResult) {
	if strings.Contains(body, "NOT_ENOUGH_PRODUCT_CHOICES") {
		result.Status = "NOT_ENOUGH_PRODUCT_CHOICES"
		result.ErrorCode = "NOT_ENOUGH_PRODUCT_CHOICES"
		if nodos := len(atpNodeMsgRegex.FindAllString(body, -1)); nodos > 0 {
			result.ErrorMessage = fmt.Sprintf("Sin inventario/capacidad en %d nodos evaluados", nodos)
		} else {
			result.ErrorMessage = "UnavailableLine sin opciones de producto"
		}
		return
	}

	if atpHasOptionRegex.MatchString(body) {
		result.Status = "CORRECTO"
		assignment := atpAssignTagRegex.FindString(body)
		option := atpOptionTagRegex.FindString(body)
		result.ShipNode = firstMatch(atpShipNodeAttr, assignment)
		result.DeliveryDate = firstMatch(atpDeliveryAttr, assignment)
		if result.DeliveryDate == "" {
			result.DeliveryDate = firstMatch(atpFirstDateAttr, option)
		}
		return
	}

	errTag := atpErrorTagRegex.FindString(body)
	result.Status = "OTRO_ERROR"
	result.ErrorCode = firstMatch(atpErrCodeAttr, errTag)
	if result.ErrorCode == "" {
		result.ErrorCode = "RESPUESTA_DESCONOCIDA"
	}
	result.ErrorMessage = firstMatch(atpErrDescAttr, errTag)
	if result.ErrorMessage == "" {
		result.ErrorMessage = strings.Join(strings.Fields(atpSnippet(body)), " ")
	}
}

// atpSnippet recorta a 300 caracteres respetando fronteras de runa, igual
// que el text.slice(0, 300) del Node original (un corte por bytes partiría
// una 'ó' y el JSON saldría con U+FFFD).
func atpSnippet(s string) string {
	if r := []rune(s); len(r) > 300 {
		return string(r[:300])
	}
	return s
}

// callAtp hace una llamada a OMS con el timeout indicado. Sin cookies y con
// User-Agent tipo curl: las cookies de Akamai y el UA por defecto hacen que
// el WAF cuelgue la conexión.
func callAtp(sku, quantity, zipCode, auth string, timeout time.Duration, result *model.AtpValidateResult) {
	started := time.Now()
	defer func() {
		result.Seconds = float64(time.Since(started).Round(10*time.Millisecond)) / float64(time.Second)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	url := os.Getenv("OMS_ATP_URL")
	if url == "" {
		url = atpDefaultURL
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url,
		strings.NewReader(atpPromiseXML(sku, quantity, zipCode)))
	if err != nil {
		result.Status = "OTRO_ERROR"
		result.ErrorCode = "CONNECTION_ERROR"
		result.ErrorMessage = err.Error()
		return
	}
	req.Header.Set("Accept", "application/xml")
	req.Header.Set("Content-Type", "application/xml")
	req.Header.Set("Authorization", auth)
	req.Header.Set("User-Agent", "curl/8.7.1")

	resp, err := atpHTTPClient.Do(req)
	if err != nil {
		var dnsErr *net.DNSError
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			result.Status = "TIMEOUT"
			result.ErrorMessage = fmt.Sprintf("Sin respuesta en %g s", timeout.Seconds())
		case errors.As(err, &dnsErr):
			result.Status = "OTRO_ERROR"
			result.ErrorCode = "DNS_NO_ROUTE"
			result.ErrorMessage = "No se resolvió el host de OMS: el servicio solo es alcanzable desde la red corporativa/VPN"
		default:
			result.Status = "OTRO_ERROR"
			result.ErrorCode = "CONNECTION_ERROR"
			result.ErrorMessage = err.Error()
		}
		return
	}
	defer resp.Body.Close()

	status := resp.StatusCode
	result.HTTPStatus = &status

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			result.Status = "TIMEOUT"
			result.HTTPStatus = nil
			result.ErrorMessage = fmt.Sprintf("Sin respuesta en %g s", timeout.Seconds())
			return
		}
		result.Status = "OTRO_ERROR"
		result.ErrorCode = "CONNECTION_ERROR"
		result.ErrorMessage = err.Error()
		return
	}

	if status < 200 || status > 299 {
		result.Status = "OTRO_ERROR"
		result.ErrorCode = fmt.Sprintf("HTTP_%d", status)
		result.ErrorMessage = strings.Join(strings.Fields(atpSnippet(string(body))), " ")
		return
	}

	classifyAtp(string(body), result)
}

// ValidateAtp valida un lote de combinaciones SKU/cantidad/CP contra OMS.
// Un item inválido NO tumba el lote: se regresa como resultado individual
// DATOS_INVALIDOS (en la tabla hay filas reales con SKU corto, p.ej. SB991).
func (o *OrdersService) ValidateAtp(
	company string, timeoutSeconds int, raw []model.AtpValidateItem,
) (results []*model.AtpValidateResult, appliedTimeout int, err error) {
	if strings.ToUpper(company) != "SB" {
		return nil, 0, ErrAtpOnlySB
	}
	if len(raw) == 0 {
		return nil, 0, ErrAtpEmptyItems
	}
	if len(raw) > AtpMaxItems {
		return nil, 0, ErrAtpTooManyItems
	}

	auth := os.Getenv("OMS_ATP_AUTH")
	if auth == "" {
		return nil, 0, ErrAtpMissingAuth
	}

	// Timeout configurable desde la UI, acotado a un rango sano: <5 s marca
	// todo como TIMEOUT, >60 s cuelga los lotes demasiado.
	appliedTimeout = timeoutSeconds
	if appliedTimeout == 0 {
		appliedTimeout = atpTimeoutDefault
	}
	appliedTimeout = min(atpTimeoutMax, max(atpTimeoutMin, appliedTimeout))
	timeout := time.Duration(appliedTimeout) * time.Second

	results = make([]*model.AtpValidateResult, len(raw))
	sem := make(chan struct{}, atpConcurrency)
	var wg sync.WaitGroup

	for i, it := range raw {
		skuOriginal := strings.TrimSpace(it.Sku)
		// Los SKU de Suburbia vienen con prefijo SB en la tabla; OMS lo espera sin él.
		sku := skuOriginal
		if len(sku) >= 2 && strings.EqualFold(sku[:2], "SB") {
			sku = sku[2:]
		}
		qty, qErr := strconv.Atoi(strings.TrimSpace(string(it.Quantity)))
		if qErr != nil || qty < 1 {
			qty = 1
		}
		qty = min(qty, 999)
		zip := strings.TrimSpace(string(it.ZipCode))

		result := &model.AtpValidateResult{
			Sku:           skuOriginal,
			SkuConsultado: sku,
			Quantity:      strconv.Itoa(qty),
			ZipCode:       zip,
		}
		results[i] = result

		if !atpSkuRegex.MatchString(sku) || !atpZipRegex.MatchString(zip) {
			result.Status = "OTRO_ERROR"
			result.ErrorCode = "DATOS_INVALIDOS"
			result.ErrorMessage = "SKU o CP inválido: no se consultó OMS"
			continue
		}

		wg.Add(1)
		go func(sku, qty, zip string, res *model.AtpValidateResult) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			callAtp(sku, qty, zip, auth, timeout, res)
		}(sku, result.Quantity, zip, result)
	}

	wg.Wait()
	return results, appliedTimeout, nil
}

// GetAtpDecommRows valida filtros y trae las filas Error del rango.
func (o *OrdersService) GetAtpDecommRows(
	ctx context.Context, company, fulfillmentType, startDate, endDate string,
) (rows []*model.AtpDecommRow, truncated bool, err error) {
	if company == "" {
		company = "SB"
	}
	if startDate == "" {
		startDate = "2026-09-08"
	}
	if endDate == "" {
		endDate = "2026-09-10"
	}
	company = strings.ToUpper(company)
	if !atpCompanyRegex.MatchString(company) {
		return nil, false, ErrInvalidCompany
	}
	if err := validateRealDates(startDate, endDate); err != nil {
		return nil, false, err
	}
	if fulfillmentType != "" && !slices.Contains(repository.FulfillmentTypes, fulfillmentType) {
		return nil, false, ErrInvalidFulfillmentType
	}
	return o.order.GetAtpDecommRows(ctx, company, fulfillmentType, startDate, endDate)
}

// GetErrorTrend valida filtros y regresa la serie diaria de errores.
func (o *OrdersService) GetErrorTrend(
	ctx context.Context, company, productType, fulfillmentType, marketPlace, channel, startDate, endDate, hourStart, hourEnd string,
) (days []*model.ErrorTrendDay, codes []*model.ErrorTrendCode, err error) {
	channel, err = normalizeChannel(channel)
	if err != nil {
		return nil, nil, err
	}
	hs, he, err := parseHourRange(hourStart, hourEnd)
	if err != nil {
		return nil, nil, err
	}
	if company == "" {
		company = "SB"
	}
	if startDate == "" {
		startDate = "2026-05-01"
	}
	if endDate == "" {
		endDate = "2026-05-28"
	}
	if err := validateRealDates(startDate, endDate); err != nil {
		return nil, nil, err
	}
	if fulfillmentType != "" && !slices.Contains(repository.FulfillmentTypes, fulfillmentType) {
		return nil, nil, ErrInvalidFulfillmentType
	}
	if marketPlace != "" && marketPlace != "true" && marketPlace != "false" {
		return nil, nil, ErrInvalidMarketPlace
	}
	return o.order.GetErrorTrend(ctx, company, productType, fulfillmentType, marketPlace, channel, startDate, endDate, hs, he)
}

// GetErrorCodesFulfillment valida filtros y regresa la comparativa por
// tipo de surtido (LP Decomm).
func (o *OrdersService) GetErrorCodesFulfillment(
	ctx context.Context, company, marketPlace, channel, startDate, endDate, hourStart, hourEnd string,
) (map[string]*model.FulfillmentSegment, error) {
	channel, err := normalizeChannel(channel)
	if err != nil {
		return nil, err
	}
	hs, he, err := parseHourRange(hourStart, hourEnd)
	if err != nil {
		return nil, err
	}
	if company == "" {
		company = "LP"
	}
	if startDate == "" {
		startDate = "2026-05-01"
	}
	if endDate == "" {
		endDate = "2026-05-28"
	}
	if err := validateRealDates(startDate, endDate); err != nil {
		return nil, err
	}
	if marketPlace != "" && marketPlace != "true" && marketPlace != "false" {
		return nil, ErrInvalidMarketPlace
	}
	return o.order.GetErrorCodesFulfillment(ctx, company, marketPlace, channel, startDate, endDate, hs, he)
}

// parseHourRange valida el filtro por hora del día (CDMX). Vacíos ambos =
// sin filtro (-1, -1); si viene uno solo o algo fuera de 0-23, error.
func parseHourRange(rawStart, rawEnd string) (int, int, error) {
	rawStart, rawEnd = strings.TrimSpace(rawStart), strings.TrimSpace(rawEnd)
	if rawStart == "" && rawEnd == "" {
		return -1, -1, nil
	}
	if rawStart == "" || rawEnd == "" {
		return 0, 0, ErrInvalidHourRange
	}
	hs, err1 := strconv.Atoi(rawStart)
	he, err2 := strconv.Atoi(rawEnd)
	if err1 != nil || err2 != nil || hs < 0 || hs > 23 || he < 0 || he > 23 {
		return 0, 0, ErrInvalidHourRange
	}
	return hs, he, nil
}

// normalizeChannel valida el filtro de canal y lo regresa en mayúsculas
// (la columna se compara con UPPER(TRIM(channel))); vacío = sin filtro.
func normalizeChannel(c string) (string, error) {
	c = strings.TrimSpace(c)
	if c == "" {
		return "", nil
	}
	if !channelRegex.MatchString(c) {
		return "", ErrInvalidChannel
	}
	return strings.ToUpper(c), nil
}

// validateRealDates exige fechas de calendario reales, no solo con la forma
// correcta: '2026-02-31' pasaría un regex y reventaría en BigQuery como 500.
func validateRealDates(dates ...string) error {
	for _, d := range dates {
		if !dateOnlyRegex.MatchString(d) {
			return ErrInvalidDateFormat
		}
		if _, err := time.Parse("2006-01-02", d); err != nil {
			return ErrInvalidDateFormat
		}
	}
	return nil
}

// GetChannelBreakdown valida filtros y regresa el reparto por canal del
// rango (misma clasificación y filtros que el resto de la vista).
func (o *OrdersService) GetChannelBreakdown(
	ctx context.Context, company, productType, fulfillmentType, marketPlace, startDate, endDate, hourStart, hourEnd string,
) ([]*model.ChannelCount, error) {
	hs, he, err := parseHourRange(hourStart, hourEnd)
	if err != nil {
		return nil, err
	}
	if company == "" {
		company = "LP"
	}
	if startDate == "" {
		startDate = "2026-05-01"
	}
	if endDate == "" {
		endDate = "2026-05-28"
	}
	if err := validateRealDates(startDate, endDate); err != nil {
		return nil, err
	}
	if fulfillmentType != "" && !slices.Contains(repository.FulfillmentTypes, fulfillmentType) {
		return nil, ErrInvalidFulfillmentType
	}
	if marketPlace != "" && marketPlace != "true" && marketPlace != "false" {
		return nil, ErrInvalidMarketPlace
	}
	return o.order.GetChannelBreakdown(ctx, company, productType, fulfillmentType, marketPlace, startDate, endDate, hs, he)
}
