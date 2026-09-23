package repository

import (
	"context"
	"errors"
	"fmt"

	"edd-panel-backend/internal/model"

	"cloud.google.com/go/bigquery"
	"golang.org/x/sync/errgroup"
	"google.golang.org/api/iterator"
)

// AtpRowsLimit acota las filas del query de decomm que alimentan la vista
// Validación ATP. Se consulta LIMIT+1 para poder anunciar el truncamiento en
// vez de dejarlo pasar en silencio.
const AtpRowsLimit = 3000

// clasificacionSQL es el mismo CASE que usan orders-decomm, error-codes y el
// CSV: si cambia aquí, cambia en todos, y los totales siempre cuadran.
const clasificacionSQL = `
	CASE
		WHEN plan = 'B' THEN 'Plan B'
		WHEN plan = 'A' AND edd1 IS NOT NULL AND edd2 IS NOT NULL THEN 'Plan A'
		ELSE 'Error'
	END`

// fulfillmentBucketSQL agrupa el tipo de surtido en los dos segmentos que
// compara la vista LP Decomm; cualquier otro valor cae en 'otro'.
const fulfillmentBucketSQL = `
	CASE fulfillmentType
		WHEN 'Fulfillment_Type_Liverpool' THEN 'domicilio'
		WHEN 'Liverpool_CNC_PICK_PACK'    THEN 'cnc'
		ELSE 'otro'
	END`

type atpRowBQ struct {
	RecordID        bigquery.NullString `bigquery:"recordId"`
	OrderNumber     bigquery.NullString `bigquery:"orderNumber"`
	Sku             bigquery.NullString `bigquery:"sku"`
	Quantity        bigquery.NullString `bigquery:"quantity"`
	ZipCode         bigquery.NullString `bigquery:"zipCode"`
	DestinationCity bigquery.NullString `bigquery:"destinationCity"`
	Channel         bigquery.NullString `bigquery:"channel"`
	FulfillmentType bigquery.NullString `bigquery:"fulfillmentType"`
	ProductType     bigquery.NullString `bigquery:"productType"`
	CreatedAt       bigquery.NullString `bigquery:"createdAt"`
	ErrorCode       bigquery.NullString `bigquery:"errorCode"`
	ErrorMessage    bigquery.NullString `bigquery:"errorMessage"`
}

// GetAtpDecommRows trae las filas clasificadas como Error del rango: las
// candidatas a validar contra el OMS en la vista Validación ATP.
func (o *Orders) GetAtpDecommRows(
	ctx context.Context,
	company, fulfillmentType, startDate, endDate string,
) (rows []*model.AtpDecommRow, truncated bool, err error) {
	params := []bigquery.QueryParameter{
		{Name: "company", Value: company},
		{Name: "start", Value: fmt.Sprintf("%s 00:00:00", startDate)},
		{Name: "end", Value: fmt.Sprintf("%s 00:00:00", endDate)},
	}

	var filterFulfillment string
	if fulfillmentType != "" {
		filterFulfillment = "AND fulfillmentType = @fulfillmentType"
		params = append(params, bigquery.QueryParameter{Name: "fulfillmentType", Value: fulfillmentType})
	}

	query := fmt.Sprintf(`
		WITH base AS (
			SELECT
				IFNULL(recordId, '')                       AS recordId,
				IFNULL(orderNumber, '')                    AS orderNumber,
				IFNULL(sku, '')                            AS sku,
				IFNULL(CAST(quantity AS STRING), '')       AS quantity,
				IFNULL(zipCode, '')                        AS zipCode,
				destinationCity,
				channel,
				fulfillmentType,
				productType,
				FORMAT_TIMESTAMP('%%Y-%%m-%%d %%H:%%M:%%S', createdAt, 'America/Mexico_City') AS createdAt,
				errorCode,
				errorMessage,
				%s AS clasificacion
			FROM `+"`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_ORDERS_TRN`"+`
			WHERE company = @company
				%s
				AND ingestionTimestamp >= TIMESTAMP(@start, 'America/Mexico_City')
				AND ingestionTimestamp <  TIMESTAMP(@end,   'America/Mexico_City')
		)
		SELECT * EXCEPT(clasificacion) FROM base
		WHERE clasificacion = 'Error'
		ORDER BY createdAt
		LIMIT %d
	`, clasificacionSQL, filterFulfillment, AtpRowsLimit+1)

	q := o.client.Query(query)
	q.Parameters = params

	it, err := q.Read(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("running atp decomm rows query: %w", err)
	}

	rows = make([]*model.AtpDecommRow, 0)
	for {
		var row atpRowBQ
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, false, fmt.Errorf("reading atp decomm rows: %w", err)
		}
		rows = append(rows, &model.AtpDecommRow{
			RecordID:        row.RecordID.StringVal,
			OrderNumber:     row.OrderNumber.StringVal,
			Sku:             row.Sku.StringVal,
			Quantity:        row.Quantity.StringVal,
			ZipCode:         row.ZipCode.StringVal,
			DestinationCity: nullStringPtr(row.DestinationCity),
			Channel:         nullStringPtr(row.Channel),
			FulfillmentType: nullStringPtr(row.FulfillmentType),
			ProductType:     nullStringPtr(row.ProductType),
			CreatedAt:       nullStringPtr(row.CreatedAt),
			ErrorCode:       nullStringPtr(row.ErrorCode),
			ErrorMessage:    nullStringPtr(row.ErrorMessage),
		})
	}

	if len(rows) > AtpRowsLimit {
		return rows[:AtpRowsLimit], true, nil
	}
	return rows, false, nil
}

type errorTrendDayBQ struct {
	Fecha   string `bigquery:"Fecha"`
	Total   int64  `bigquery:"total"`
	Errores int64  `bigquery:"errores"`
}

type errorTrendCodeBQ struct {
	Fecha     string `bigquery:"Fecha"`
	ErrorCode string `bigquery:"errorCode"`
	Total     int64  `bigquery:"total"`
}

// GetErrorTrend regresa la serie diaria de errores por causal más el total
// de líneas/errores por día, con los MISMOS filtros que GetErrorCodes para
// que la gráfica de tendencia cuadre con la dona.
func (o *Orders) GetErrorTrend(
	ctx context.Context,
	company, productType, fulfillmentType, marketPlace, channel, startDate, endDate string,
	hourStart, hourEnd int,
) (days []*model.ErrorTrendDay, codes []*model.ErrorTrendCode, err error) {
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
	var filterFulfillment string
	if fulfillmentType != "" {
		filterFulfillment = "AND fulfillmentType = @fulfillmentType"
		params = append(params, bigquery.QueryParameter{Name: "fulfillmentType", Value: fulfillmentType})
	}
	var filterMarketplace string
	if marketPlace != "" {
		filterMarketplace = "AND marketPlace = @marketPlace"
		params = append(params, bigquery.QueryParameter{Name: "marketPlace", Value: marketPlace == "true"})
	}
	var filterChannel string
	if channel != "" {
		filterChannel = "AND UPPER(TRIM(channel)) = @channel"
		params = append(params, bigquery.QueryParameter{Name: "channel", Value: channel})
	}
	var filterHour string
	filterHour, params = hourFilter(hourStart, hourEnd, params)

	baseCTE := fmt.Sprintf(`
		WITH base AS (
			SELECT
				FORMAT_TIMESTAMP('%%Y-%%m-%%d', ingestionTimestamp, 'America/Mexico_City') AS Fecha,
				%s AS errorCode,
				%s AS clasificacion
			FROM `+"`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_ORDERS_TRN`"+`
			WHERE company = @company
				%s
				%s
				%s
				%s
				%s
				AND ingestionTimestamp >= TIMESTAMP(@start, 'America/Mexico_City')
				AND ingestionTimestamp <  TIMESTAMP(@end,   'America/Mexico_City')
		)
	`, errorCodeNormSQL, clasificacionSQL, filterProductType, filterFulfillment, filterMarketplace, filterChannel, filterHour)

	queryDays := baseCTE + `
		SELECT
			Fecha,
			COUNT(*)                         AS total,
			COUNTIF(clasificacion = 'Error') AS errores
		FROM base
		GROUP BY Fecha
		ORDER BY Fecha
	`

	queryCodes := baseCTE + `
		SELECT Fecha, errorCode, COUNT(*) AS total
		FROM base
		WHERE clasificacion = 'Error'
		GROUP BY Fecha, errorCode
		ORDER BY Fecha
	`

	// Los dos queries van en paralelo, como el Promise.all del server.js:
	// en serie la latencia del endpoint sería la suma en vez del máximo.
	g, gctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		qd := o.client.Query(queryDays)
		qd.Parameters = params
		itd, err := qd.Read(gctx)
		if err != nil {
			return fmt.Errorf("running error trend days query: %w", err)
		}
		days = make([]*model.ErrorTrendDay, 0)
		for {
			var row errorTrendDayBQ
			err := itd.Next(&row)
			if errors.Is(err, iterator.Done) {
				break
			}
			if err != nil {
				return fmt.Errorf("reading error trend days: %w", err)
			}
			days = append(days, &model.ErrorTrendDay{Fecha: row.Fecha, Total: row.Total, Errores: row.Errores})
		}
		return nil
	})

	g.Go(func() error {
		qc := o.client.Query(queryCodes)
		qc.Parameters = params
		itc, err := qc.Read(gctx)
		if err != nil {
			return fmt.Errorf("running error trend codes query: %w", err)
		}
		codes = make([]*model.ErrorTrendCode, 0)
		for {
			var row errorTrendCodeBQ
			err := itc.Next(&row)
			if errors.Is(err, iterator.Done) {
				break
			}
			if err != nil {
				return fmt.Errorf("reading error trend codes: %w", err)
			}
			codes = append(codes, &model.ErrorTrendCode{Fecha: row.Fecha, ErrorCode: row.ErrorCode, Total: row.Total})
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, nil, err
	}
	return days, codes, nil
}

type fulfillmentTotalsBQ struct {
	Segmento string `bigquery:"segmento"`
	Total    int64  `bigquery:"total"`
	Errores  int64  `bigquery:"errores"`
}

type fulfillmentCodeBQ struct {
	Segmento     string              `bigquery:"segmento"`
	ErrorCode    string              `bigquery:"errorCode"`
	ErrorMessage bigquery.NullString `bigquery:"errorMessage"`
	Total        int64               `bigquery:"total"`
}

// GetErrorCodesFulfillment desglosa el % Error en dos cortes a la vez para
// LP Decomm: tamaño/tasa de error por tipo de surtido y composición por
// errorCode dentro de cada segmento.
func (o *Orders) GetErrorCodesFulfillment(
	ctx context.Context,
	company, marketPlace, channel, startDate, endDate string,
	hourStart, hourEnd int,
) (map[string]*model.FulfillmentSegment, error) {
	params := []bigquery.QueryParameter{
		{Name: "company", Value: company},
		{Name: "start", Value: fmt.Sprintf("%s 00:00:00", startDate)},
		{Name: "end", Value: fmt.Sprintf("%s 00:00:00", endDate)},
	}

	var filterMarketplace string
	if marketPlace != "" {
		filterMarketplace = "AND marketPlace = @marketPlace"
		params = append(params, bigquery.QueryParameter{Name: "marketPlace", Value: marketPlace == "true"})
	}
	var filterChannel string
	if channel != "" {
		filterChannel = "AND UPPER(TRIM(channel)) = @channel"
		params = append(params, bigquery.QueryParameter{Name: "channel", Value: channel})
	}
	var filterHour string
	filterHour, params = hourFilter(hourStart, hourEnd, params)

	baseCTE := fmt.Sprintf(`
		WITH base AS (
			SELECT
				%s AS segmento,
				%s AS errorCode,
				errorMessage,
				%s AS clasificacion
			FROM `+"`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_ORDERS_TRN`"+`
			WHERE company = @company
				%s
				%s
				%s
				AND ingestionTimestamp >= TIMESTAMP(@start, 'America/Mexico_City')
				AND ingestionTimestamp <  TIMESTAMP(@end,   'America/Mexico_City')
		)
	`, fulfillmentBucketSQL, errorCodeNormSQL, clasificacionSQL, filterMarketplace, filterChannel, filterHour)

	segments := map[string]*model.FulfillmentSegment{
		"domicilio": {Codes: []*model.ErrorCodeCount{}},
		"cnc":       {Codes: []*model.ErrorCodeCount{}},
		"otro":      {Codes: []*model.ErrorCodeCount{}},
	}

	queryTotals := baseCTE + `
		SELECT
			segmento,
			COUNT(*)                         AS total,
			COUNTIF(clasificacion = 'Error') AS errores
		FROM base
		GROUP BY segmento
	`
	queryCodes := baseCTE + `
		SELECT
			segmento,
			errorCode,
			ANY_VALUE(NULLIF(TRIM(errorMessage), '')) AS errorMessage,
			COUNT(*)                                  AS total
		FROM base
		WHERE clasificacion = 'Error'
		GROUP BY segmento, errorCode
		ORDER BY segmento, total DESC
	`

	// En paralelo (Promise.all del original); cada goroutine acumula en sus
	// propias variables y se fusionan en segments después del Wait.
	var totals []fulfillmentTotalsBQ
	var codeRows []fulfillmentCodeBQ
	g, gctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		qt := o.client.Query(queryTotals)
		qt.Parameters = params
		itt, err := qt.Read(gctx)
		if err != nil {
			return fmt.Errorf("running fulfillment totals query: %w", err)
		}
		for {
			var row fulfillmentTotalsBQ
			err := itt.Next(&row)
			if errors.Is(err, iterator.Done) {
				break
			}
			if err != nil {
				return fmt.Errorf("reading fulfillment totals: %w", err)
			}
			totals = append(totals, row)
		}
		return nil
	})

	g.Go(func() error {
		qc := o.client.Query(queryCodes)
		qc.Parameters = params
		itc, err := qc.Read(gctx)
		if err != nil {
			return fmt.Errorf("running fulfillment codes query: %w", err)
		}
		for {
			var row fulfillmentCodeBQ
			err := itc.Next(&row)
			if errors.Is(err, iterator.Done) {
				break
			}
			if err != nil {
				return fmt.Errorf("reading fulfillment codes: %w", err)
			}
			codeRows = append(codeRows, row)
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}

	for _, row := range totals {
		if seg, ok := segments[row.Segmento]; ok {
			seg.Total = row.Total
			seg.Errores = row.Errores
		}
	}
	for _, row := range codeRows {
		if seg, ok := segments[row.Segmento]; ok {
			seg.Codes = append(seg.Codes, &model.ErrorCodeCount{
				ErrorCode:    row.ErrorCode,
				ErrorMessage: nullStringPtr(row.ErrorMessage),
				Total:        row.Total,
			})
		}
	}

	return segments, nil
}
