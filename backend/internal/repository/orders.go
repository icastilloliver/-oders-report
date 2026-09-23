package repository

import (
	"context"
	"edd-panel-backend/internal/model"
	"edd-panel-backend/pkg/utils"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/bigquery"
	"google.golang.org/api/iterator"
)

type OrdersRepository interface {
	GetOrdersSummary(ctx context.Context, productType, fulfillmentType, isMarketplace, channel string, hourStart, hourEnd int, company, startDate, endDate string) ([]*model.OrdersSummary, error)
	RecalculateOrders(ctx context.Context, startDate, endDate, company string) ([]*model.OrdersSummary, error)
	GetDeliveryTypes(ctx context.Context, company, productType, startDate, endDate string) (*model.DeliveryTypesResult, error)
	SearchOrder(ctx context.Context, p OrderSearchParams) (lines []*model.OrderSearchLine, truncated bool, err error)
	GetOrdersCSV(ctx context.Context, params OrdersCSVParams) (*OrdersCSVStream, error)
	GetErrorCodes(ctx context.Context, company, productType, fulfillmentType, marketPlace, channel, startDate, endDate string, hourStart, hourEnd int) (*model.ErrorCodesResult, error)
	BulkCheckOrders(ctx context.Context, candidates []string) ([]*model.BulkCheckDetailLine, error)
	GetErrorCodesCSV(ctx context.Context, params ErrorCodesCSVParams) (header []string, rows [][]string, truncated bool, err error)
	GetAtpDecommRows(ctx context.Context, company, fulfillmentType, startDate, endDate string) (rows []*model.AtpDecommRow, truncated bool, err error)
	GetErrorTrend(ctx context.Context, company, productType, fulfillmentType, marketPlace, channel, startDate, endDate string, hourStart, hourEnd int) (days []*model.ErrorTrendDay, codes []*model.ErrorTrendCode, err error)
	GetErrorCodesFulfillment(ctx context.Context, company, marketPlace, channel, startDate, endDate string, hourStart, hourEnd int) (map[string]*model.FulfillmentSegment, error)
	GetChannelBreakdown(ctx context.Context, company, productType, fulfillmentType, marketPlace, startDate, endDate string, hourStart, hourEnd int) ([]*model.ChannelCount, error)
}

// productTypeVariants espeja al helper homónimo de server.js: 'BIG TICKET'/'BT'
// y 'SOFT LINE'/'SL' se tratan como sinónimos porque la columna productType en
// BigQuery no está normalizada entre ambas grafías.
func productTypeVariants(productType string) []string {
	pt := strings.ToUpper(strings.TrimSpace(productType))
	switch pt {
	case "BIG TICKET", "BT":
		return []string{"BIG TICKET", "BT"}
	case "SOFT LINE", "SL":
		return []string{"SOFT LINE", "SL"}
	default:
		return []string{pt}
	}
}

// hourFilter arma el filtro por hora del día en zona America/Mexico_City y
// agrega sus parámetros. hourStart/hourEnd en -1 = sin filtro. Soporta
// rangos que cruzan medianoche (22 → 03).
func hourFilter(hourStart, hourEnd int, params []bigquery.QueryParameter) (string, []bigquery.QueryParameter) {
	if hourStart < 0 || hourEnd < 0 {
		return "", params
	}
	const h = "EXTRACT(HOUR FROM ingestionTimestamp AT TIME ZONE 'America/Mexico_City')"
	clause := `AND (
		(@hourStart <= @hourEnd AND ` + h + ` BETWEEN @hourStart AND @hourEnd)
		OR (@hourStart > @hourEnd AND (` + h + ` >= @hourStart OR ` + h + ` <= @hourEnd))
	)`
	params = append(params,
		bigquery.QueryParameter{Name: "hourStart", Value: hourStart},
		bigquery.QueryParameter{Name: "hourEnd", Value: hourEnd},
	)
	return clause, params
}

type Orders struct {
	client *bigquery.Client
}

func NewOrdersRepository(client *bigquery.Client) OrdersRepository {
	return &Orders{
		client: client,
	}
}

func (o *Orders) GetOrdersSummary(
	ctx context.Context,
	productType, fulfillmentType, isMarketplace, channel string,
	hourStart, hourEnd int,
	company, startDate, endDate string,
) ([]*model.OrdersSummary, error) {
	loc, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		return nil, fmt.Errorf("loading timezone America/Mexico_City: %w", err)
	}

	start, err := time.ParseInLocation("2006-01-02", startDate, loc)
	if err != nil {
		return nil, fmt.Errorf("invalid startDate, use YYYY-MM-DD format: %w", err)
	}
	end, err := time.ParseInLocation("2006-01-02", endDate, loc)
	if err != nil {
		return nil, fmt.Errorf("invalid endDate, use YYYY-MM-DD format: %w", err)
	}
	if !end.After(start) {
		return nil, fmt.Errorf("endDate (%s) must be after startDate (%s)", endDate, startDate)
	}

	params := []bigquery.QueryParameter{
		{Name: "company", Value: company},
		{Name: "startDate", Value: start},
		{Name: "endDate", Value: end},
	}

	var filters strings.Builder

	if productType != "" {
		filters.WriteString(" AND productType = @productType")
		params = append(params, bigquery.QueryParameter{Name: "productType", Value: productType})
	}

	if fulfillmentType != "" {
		filters.WriteString(" AND fulfillmentType = @fulfillmentType")
		params = append(params, bigquery.QueryParameter{Name: "fulfillmentType", Value: fulfillmentType})
	}

	if channel != "" {
		filters.WriteString(" AND UPPER(TRIM(channel)) = @channel")
		params = append(params, bigquery.QueryParameter{Name: "channel", Value: strings.ToUpper(strings.TrimSpace(channel))})
	}

	if isMarketplace != "" {
		// The marketPlace column is BOOL in BigQuery.
		v, err := strconv.ParseBool(strings.TrimSpace(isMarketplace))
		if err != nil {
			return nil, fmt.Errorf("invalid isMarketplace: %q", isMarketplace)
		}
		filters.WriteString(" AND marketPlace = @marketPlace")
		params = append(params, bigquery.QueryParameter{Name: "marketPlace", Value: v})
	}

	var hourClause string
	hourClause, params = hourFilter(hourStart, hourEnd, params)
	if hourClause != "" {
		filters.WriteString(" " + hourClause)
	}

	const ordersTableName = "`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_ORDERS_TRN`"
	const ordersSummaryQuery = `
			WITH base AS (
			SELECT
				FORMAT_TIMESTAMP('%%Y-%%m-%%d', ingestionTimestamp, 'America/Mexico_City') AS Fecha,
				plan,
				edd1,
				edd2
			FROM %s  
			WHERE company = @company%s
				AND ingestionTimestamp >= @startDate
				AND ingestionTimestamp <  @endDate
			),
			clasificado AS (
			SELECT
				Fecha,
				CASE
				WHEN plan = 'B' THEN 'Plan B'
				WHEN plan = 'A' AND edd1 IS NOT NULL AND edd2 IS NOT NULL THEN 'Plan A'
				ELSE 'Error'
				END AS clasificacion
			FROM base
			)
			SELECT
			Fecha,
			COUNTIF(clasificacion = 'Plan A') AS Plan_A,
			COUNTIF(clasificacion = 'Plan B') AS Plan_B,
			COUNTIF(clasificacion = 'Error')  AS Error,
			COUNT(*)                          AS Total
			FROM clasificado
			GROUP BY Fecha
			ORDER BY Fecha
			`
	finalSQL := fmt.Sprintf(ordersSummaryQuery, ordersTableName, filters.String())
	q := o.client.Query(finalSQL)
	q.Parameters = params

	dry := *q
	dry.DryRun = true
	if _, err := dry.Run(ctx); err != nil {
		return nil, fmt.Errorf("validating orders summary query (dry run): %w", err)
	}

	it, err := q.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("running orders summary query: %w", err)
	}

	summaries := make([]*model.OrdersSummary, 0)
	for {
		var row model.OrdersSummary
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading orders summary results: %w", err)
		}
		summaries = append(summaries, &row)
	}

	utils.Logging("INFO", "Orders quantity found", "", map[string]int{"count": len(summaries)})

	return summaries, nil
}
func (o *Orders) RecalculateOrders(
	ctx context.Context,
	startDate, endDate, company string,
) ([]*model.OrdersSummary, error) {
	loc, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		return nil, fmt.Errorf("loading timezone America/Mexico_City: %w", err)
	}

	start, err := time.ParseInLocation("2006-01-02", startDate, loc)
	if err != nil {
		return nil, fmt.Errorf("invalid startDate, use YYYY-MM-DD format: %w", err)
	}
	end, err := time.ParseInLocation("2006-01-02", endDate, loc)
	if err != nil {
		return nil, fmt.Errorf("invalid endDate, use YYYY-MM-DD format: %w", err)
	}
	if !end.After(start) {
		return nil, fmt.Errorf("endDate (%s) must be after startDate (%s)", endDate, startDate)
	}

	// EnterpriseCode in the JSON uses the full name, not the short company code.
	enterpriseCode := "Liverpool"
	if company == "SB" || company == "SBB" {
		enterpriseCode = "Suburbia"
	}

	params := []bigquery.QueryParameter{
		{Name: "enterpriseCode", Value: enterpriseCode},
		{Name: "startDate", Value: start},
		{Name: "endDate", Value: end},
	}

	const recalculateOrdersTableName = "`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_RECALCULATE_TRN`"
	const recalcQuery = ` WITH base AS (
        SELECT
          FORMAT_TIMESTAMP('%Y-%m-%d', _ingested_at, 'America/Mexico_City') AS Fecha,
          JSON_EXTRACT_SCALAR(rawPayload, '$.Order.OrderLines.OrderLine[0].Extn.ExtnPromiseEDD1') as edd1,
          JSON_EXTRACT_SCALAR(rawPayload, '$.Order.OrderLines.OrderLine[0].Extn.ExtnPromiseEDD2') as edd2
        FROM ` + recalculateOrdersTableName + `
        WHERE messageType = 'ORDER_CREATED'
          AND JSON_EXTRACT_SCALAR(rawPayload, '$.Order.EnterpriseCode') = @enterpriseCode
          AND _ingested_at >= @startDate
          AND _ingested_at <  @endDate
      ),
      clasificado AS (
        SELECT
          Fecha,
          CASE
            WHEN edd1 IS NOT NULL AND edd2 IS NOT NULL THEN 'Plan A'
            ELSE 'Error'
          END AS clasificacion
        FROM base
      )
      SELECT
        Fecha,
        COUNTIF(clasificacion = 'Plan A') AS Plan_A,
        0 AS Plan_B,
        COUNTIF(clasificacion = 'Error')  AS Error,
        COUNT(*)                          AS Total
      FROM clasificado
      GROUP BY Fecha
      ORDER BY Fecha`

	q := o.client.Query(recalcQuery)
	q.Parameters = params
	dry := *q
	dry.DryRun = true
	if _, err := dry.Run(ctx); err != nil {
		return nil, fmt.Errorf("validating orders recalculation query (dry run): %w", err)
	}

	it, err := q.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("running orders recalculation query: %w", err)
	}

	summaries := make([]*model.OrdersSummary, 0)
	for {
		var row model.OrdersSummary
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading orders summary results: %w", err)
		}
		summaries = append(summaries, &row)
	}

	return summaries, nil
}

// GetDeliveryTypes clasifica cada línea según la promesa de entrega:
//
//	edd1 = edd2 = día de compra      -> Flash Mismo Día
//	edd1 = edd2 = día siguiente      -> Siguiente Día
//	cualquier otro caso con fechas   -> Estándar
//	sin edd1 o edd2                  -> Sin EDD
//
// Además regresa las asignaciones por tienda (columna origen).
func (o *Orders) GetDeliveryTypes(
	ctx context.Context,
	company, productType, startDate, endDate string,
) (*model.DeliveryTypesResult, error) {
	const baseCTE = `
		WITH base AS (
			SELECT
				FORMAT_TIMESTAMP('%%Y-%%m-%%d', ingestionTimestamp, 'America/Mexico_City') AS Fecha,
				DATE(createdAt, 'America/Mexico_City') AS fechaCompra,
				edd1,
				edd2,
				origen
			FROM ` + "`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_ORDERS_TRN`" + `
			WHERE company = @company
				%s
				AND ingestionTimestamp >= TIMESTAMP(@start, 'America/Mexico_City')
				AND ingestionTimestamp <  TIMESTAMP(@end,   'America/Mexico_City')
		),
		clasificado AS (
			SELECT
				Fecha,
				origen,
				CASE
					WHEN edd1 IS NULL OR edd2 IS NULL THEN 'SinEDD'
					WHEN edd1 = edd2 AND edd1 = fechaCompra THEN 'Flash'
					WHEN edd1 = edd2 AND edd1 = DATE_ADD(fechaCompra, INTERVAL 1 DAY) THEN 'SiguienteDia'
					ELSE 'Estandar'
				END AS tipo
			FROM base
		)
	`

	params := []bigquery.QueryParameter{
		{Name: "company", Value: company},
		{Name: "start", Value: fmt.Sprintf("%s 00:00:00", startDate)},
		{Name: "end", Value: fmt.Sprintf("%s 00:00:00", endDate)},
	}

	var filterProductType string
	if productType != "" {
		filterProductType = "AND UPPER(TRIM(productType)) IN UNNEST(@productTypes)"
		params = append(params, bigquery.QueryParameter{Name: "productTypes", Value: productTypeVariants(productType)})
	}

	finalBaseCTE := fmt.Sprintf(baseCTE, filterProductType)

	queryByDay := finalBaseCTE + `
		SELECT
			Fecha,
			COUNTIF(tipo = 'Flash')        AS Flash,
			COUNTIF(tipo = 'SiguienteDia') AS Siguiente_Dia,
			COUNTIF(tipo = 'Estandar')     AS Estandar,
			COUNTIF(tipo = 'SinEDD')       AS Sin_EDD,
			COUNT(*)                       AS Total
		FROM clasificado
		GROUP BY Fecha
		ORDER BY Fecha
	`

	// origen NULL = línea surtida fuera de la red propia (mayormente Marketplace)
	queryStores := finalBaseCTE + `
		SELECT
			IFNULL(origen, 'MKTP') AS tienda,
			COUNT(*) AS asignaciones
		FROM clasificado
		GROUP BY tienda
		ORDER BY asignaciones DESC
	`

	var (
		byDay     []*model.DeliveryTypeByDay
		stores    []*model.DeliveryTypeStore
		byDayErr  error
		storesErr error
		wg        sync.WaitGroup
	)

	wg.Add(2)
	go func() {
		defer wg.Done()
		byDay, byDayErr = runDeliveryTypesByDayQuery(ctx, o.client, queryByDay, params)
	}()
	go func() {
		defer wg.Done()
		stores, storesErr = runDeliveryTypesStoresQuery(ctx, o.client, queryStores, params)
	}()
	wg.Wait()

	if byDayErr != nil {
		return nil, fmt.Errorf("running delivery types by day query: %w", byDayErr)
	}
	if storesErr != nil {
		return nil, fmt.Errorf("running delivery types stores query: %w", storesErr)
	}

	totals := model.DeliveryTypeTotals{}
	for _, d := range byDay {
		totals.Flash += d.Flash
		totals.SiguienteDia += d.SiguienteDia
		totals.Estandar += d.Estandar
		totals.SinEDD += d.SinEDD
		totals.Total += d.Total
	}

	return &model.DeliveryTypesResult{
		ByDay:  byDay,
		Stores: stores,
		Totals: totals,
	}, nil
}

func runDeliveryTypesByDayQuery(ctx context.Context, client *bigquery.Client, query string, params []bigquery.QueryParameter) ([]*model.DeliveryTypeByDay, error) {
	q := client.Query(query)
	q.Parameters = params

	it, err := q.Read(ctx)
	if err != nil {
		return nil, err
	}

	rows := make([]*model.DeliveryTypeByDay, 0)
	for {
		var row model.DeliveryTypeByDay
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, err
		}
		rows = append(rows, &row)
	}
	return rows, nil
}

func runDeliveryTypesStoresQuery(ctx context.Context, client *bigquery.Client, query string, params []bigquery.QueryParameter) ([]*model.DeliveryTypeStore, error) {
	q := client.Query(query)
	q.Parameters = params

	it, err := q.Read(ctx)
	if err != nil {
		return nil, err
	}

	rows := make([]*model.DeliveryTypeStore, 0)
	for {
		var row model.DeliveryTypeStore
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, err
		}
		rows = append(rows, &row)
	}
	return rows, nil
}

// orderSearchRow espeja el resultado crudo de la consulta de order-search.
// La mayoría de las columnas son NULLABLE en BigQuery, así que se leen como
// tipos Null* y luego se convierten a punteros para el modelo público
// (nil -> `null` en JSON, igual que el driver de Node).
type orderSearchRow struct {
	OrderNumber             bigquery.NullString `bigquery:"orderNumber"`
	SKU                     bigquery.NullString `bigquery:"sku"`
	Quantity                bigquery.NullInt64  `bigquery:"quantity"`
	Origen                  bigquery.NullString `bigquery:"origen"`
	StoreSelected           bigquery.NullString `bigquery:"storeSelected"`
	FulfillmentType         bigquery.NullString `bigquery:"fulfillmentType"`
	ProductType             bigquery.NullString `bigquery:"productType"`
	Company                 bigquery.NullString `bigquery:"company"`
	Channel                 bigquery.NullString `bigquery:"channel"`
	MarketPlace             bigquery.NullString `bigquery:"marketPlace"`
	PaymentMethod           bigquery.NullString `bigquery:"paymentMethod"`
	ZipCode                 bigquery.NullString `bigquery:"zipCode"`
	DestinationCity         bigquery.NullString `bigquery:"destinationCity"`
	DestinationMunicipality bigquery.NullString `bigquery:"destinationMunicipality"`
	DestinationSuburb       bigquery.NullString `bigquery:"destinationSuburb"`
	DestinationStreet       bigquery.NullString `bigquery:"destinationStreet"`
	CreatedAt               bigquery.NullString `bigquery:"createdAt"`
	EDD1                    bigquery.NullString `bigquery:"edd1"`
	EDD2                    bigquery.NullString `bigquery:"edd2"`
	EstimatedDeliveryLabel  bigquery.NullString `bigquery:"estimatedDeliveryLabel"`
	Plan                    bigquery.NullString `bigquery:"plan"`
	HasError                bigquery.NullString `bigquery:"hasError"`
	ErrorCode               bigquery.NullString `bigquery:"errorCode"`
	ErrorMessage            bigquery.NullString `bigquery:"errorMessage"`
	IsOk                    bigquery.NullString `bigquery:"isOk"`
	Ticket                  bigquery.NullString `bigquery:"ticket"`
	RecordID                bigquery.NullString `bigquery:"recordId"`
	TipoEntrega             bigquery.NullString `bigquery:"tipoEntrega"`
}

func nullStringPtr(n bigquery.NullString) *string {
	if !n.Valid {
		return nil
	}
	return &n.StringVal
}

func nullInt64Ptr(n bigquery.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	return &n.Int64
}

func (r orderSearchRow) toModel() *model.OrderSearchLine {
	return &model.OrderSearchLine{
		OrderNumber:             r.OrderNumber.StringVal,
		SKU:                     nullStringPtr(r.SKU),
		Quantity:                nullInt64Ptr(r.Quantity),
		Origen:                  nullStringPtr(r.Origen),
		StoreSelected:           nullStringPtr(r.StoreSelected),
		FulfillmentType:         nullStringPtr(r.FulfillmentType),
		ProductType:             nullStringPtr(r.ProductType),
		Company:                 nullStringPtr(r.Company),
		Channel:                 nullStringPtr(r.Channel),
		MarketPlace:             nullStringPtr(r.MarketPlace),
		PaymentMethod:           nullStringPtr(r.PaymentMethod),
		ZipCode:                 nullStringPtr(r.ZipCode),
		DestinationCity:         nullStringPtr(r.DestinationCity),
		DestinationMunicipality: nullStringPtr(r.DestinationMunicipality),
		DestinationSuburb:       nullStringPtr(r.DestinationSuburb),
		DestinationStreet:       nullStringPtr(r.DestinationStreet),
		CreatedAt:               nullStringPtr(r.CreatedAt),
		EDD1:                    nullStringPtr(r.EDD1),
		EDD2:                    nullStringPtr(r.EDD2),
		EstimatedDeliveryLabel:  nullStringPtr(r.EstimatedDeliveryLabel),
		Plan:                    nullStringPtr(r.Plan),
		HasError:                nullStringPtr(r.HasError),
		ErrorCode:               nullStringPtr(r.ErrorCode),
		ErrorMessage:            nullStringPtr(r.ErrorMessage),
		IsOk:                    nullStringPtr(r.IsOk),
		Ticket:                  nullStringPtr(r.Ticket),
		RecordID:                nullStringPtr(r.RecordID),
		TipoEntrega:             r.TipoEntrega.StringVal,
	}
}

// SearchOrder busca una orden/remisión por número en FAC_EDD_ORDERS_TRN
// (Decomm), sobre los últimos 180 días, sin importar la compañía. Devuelve
// todas las líneas (SKUs) con su tipo de entrega ya clasificado.
// OrderSearchParams: exactamente uno de OrderNumber/SkuVariants viene lleno
// (lo garantiza el servicio). Start/End vacíos = últimos 180 días.
type OrderSearchParams struct {
	// OrderNumberVariants incluye el ID tal cual y su variante sin prefijo
	// de letras (sg2609080001809 → 2609080001809), como el cotejo masivo.
	OrderNumberVariants []string
	SkuVariants         []string
	Start               string
	End                 string
}

// OrderSearchMaxRows acota la búsqueda por SKU (una orden tiene pocas líneas,
// pero un SKU popular puede aparecer en miles).
const OrderSearchMaxRows = 500

func (o *Orders) SearchOrder(ctx context.Context, p OrderSearchParams) ([]*model.OrderSearchLine, bool, error) {
	params := []bigquery.QueryParameter{}

	// Ventana de tiempo: rango explícito (end exclusivo, como el resto de la
	// app) o los últimos 180 días de siempre.
	timeFilter := "ingestionTimestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 180 DAY)"
	if p.Start != "" && p.End != "" {
		timeFilter = `ingestionTimestamp >= TIMESTAMP(@start, 'America/Mexico_City')
			AND ingestionTimestamp <  TIMESTAMP(@end,   'America/Mexico_City')`
		params = append(params,
			bigquery.QueryParameter{Name: "start", Value: fmt.Sprintf("%s 00:00:00", p.Start)},
			bigquery.QueryParameter{Name: "end", Value: fmt.Sprintf("%s 00:00:00", p.End)},
		)
	}

	var matchFilter, orderBy, limit string
	if len(p.OrderNumberVariants) > 0 {
		matchFilter = "AND orderNumber IN UNNEST(@orderNumbers)"
		orderBy = "ORDER BY edd1 NULLS LAST, sku"
		params = append(params, bigquery.QueryParameter{Name: "orderNumbers", Value: p.OrderNumberVariants})
	} else {
		matchFilter = "AND TRIM(sku) IN UNNEST(@skus)"
		orderBy = "ORDER BY createdAt DESC, orderNumber"
		limit = fmt.Sprintf("LIMIT %d", OrderSearchMaxRows+1)
		params = append(params, bigquery.QueryParameter{Name: "skus", Value: p.SkuVariants})
	}

	query := `
		SELECT
			orderNumber,
			sku,
			quantity,
			origen,
			storeSelected,
			fulfillmentType,
			productType,
			company,
			channel,
			CAST(marketPlace AS STRING) AS marketPlace,
			paymentMethod,
			zipCode,
			destinationCity,
			destinationMunicipality,
			destinationSuburb,
			destinationStreet,
			FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', createdAt, 'America/Mexico_City') AS createdAt,
			CAST(edd1 AS STRING) AS edd1,
			CAST(edd2 AS STRING) AS edd2,
			estimatedDeliveryLabel,
			plan,
			CAST(hasError AS STRING) AS hasError,
			errorCode,
			errorMessage,
			CAST(isOk AS STRING) AS isOk,
			ticket,
			recordId,
			CASE
				WHEN edd1 IS NULL OR edd2 IS NULL THEN 'sin_edd'
				WHEN edd1 = edd2 AND edd1 = DATE(createdAt, 'America/Mexico_City') THEN 'flash'
				WHEN edd1 = edd2 AND edd1 = DATE_ADD(DATE(createdAt, 'America/Mexico_City'), INTERVAL 1 DAY) THEN 'siguiente_dia'
				ELSE 'estandar'
			END AS tipoEntrega
		FROM ` + "`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_ORDERS_TRN`" + `
		WHERE ` + timeFilter + `
			` + matchFilter + `
		` + orderBy + `
		` + limit + `
	`

	q := o.client.Query(query)
	q.Parameters = params

	it, err := q.Read(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("running order search query: %w", err)
	}

	lines := make([]*model.OrderSearchLine, 0)
	for {
		var row orderSearchRow
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, false, fmt.Errorf("reading order search results: %w", err)
		}
		lines = append(lines, row.toModel())
	}

	if len(p.OrderNumberVariants) == 0 && len(lines) > OrderSearchMaxRows {
		return lines[:OrderSearchMaxRows], true, nil
	}
	return lines, false, nil
}
