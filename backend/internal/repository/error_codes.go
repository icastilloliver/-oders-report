package repository

import (
	"context"
	"edd-panel-backend/internal/model"
	"errors"
	"fmt"

	"cloud.google.com/go/bigquery"
	"google.golang.org/api/iterator"
)

// errorCodeNormSQL normaliza errorCode igual que el frontend
// (errorCatalog.normalizeCode): NULL o vacío -> 'SIN CÓDIGO', '04' -> '4',
// 'abc' -> 'ABC'. Así la dona, sus porcentajes y el CSV de cada rebanada
// hablan siempre del mismo grupo.
const errorCodeNormSQL = `
	CASE
		WHEN errorCode IS NULL OR TRIM(errorCode) = '' THEN 'SIN CÓDIGO'
		WHEN REGEXP_CONTAINS(TRIM(errorCode), r'^\d+$')
			THEN IFNULL(CAST(SAFE_CAST(TRIM(errorCode) AS INT64) AS STRING), UPPER(TRIM(errorCode)))
		ELSE UPPER(TRIM(errorCode))
	END`

type errorCodeRow struct {
	ErrorCode    string              `bigquery:"errorCode"`
	ErrorMessage bigquery.NullString `bigquery:"errorMessage"`
	Total        int64               `bigquery:"total"`
}

// GetErrorCodes desglosa los registros clasificados como Error por
// errorCode (ya normalizado), para la dona "Composición del % Error por
// errorCode" del dashboard SBB Decomm.
func (o *Orders) GetErrorCodes(
	ctx context.Context,
	company, productType, fulfillmentType, marketPlace, startDate, endDate string,
) (*model.ErrorCodesResult, error) {
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

	// Filtro por tipo de producto (marketPlace) · lo usa el tab LP Decomm
	var filterMarketplace string
	if marketPlace != "" {
		filterMarketplace = "AND marketPlace = @marketPlace"
		params = append(params, bigquery.QueryParameter{Name: "marketPlace", Value: marketPlace == "true"})
	}

	query := fmt.Sprintf(`
		WITH base AS (
			SELECT
				%s AS errorCode,
				errorMessage,
				CASE
					WHEN plan = 'B' THEN 'Plan B'
					WHEN plan = 'A' AND edd1 IS NOT NULL AND edd2 IS NOT NULL THEN 'Plan A'
					ELSE 'Error'
				END AS clasificacion
			FROM `+"`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_ORDERS_TRN`"+`
			WHERE company = @company
				%s
				%s
				%s
				AND ingestionTimestamp >= TIMESTAMP(@start, 'America/Mexico_City')
				AND ingestionTimestamp <  TIMESTAMP(@end,   'America/Mexico_City')
		)
		SELECT
			errorCode,
			ANY_VALUE(NULLIF(TRIM(errorMessage), '')) AS errorMessage,
			COUNT(*)                                  AS total
		FROM base
		WHERE clasificacion = 'Error'
		GROUP BY errorCode
		ORDER BY total DESC
	`, errorCodeNormSQL, filterProductType, filterFulfillment, filterMarketplace)

	q := o.client.Query(query)
	q.Parameters = params

	it, err := q.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("running error codes query: %w", err)
	}

	data := make([]*model.ErrorCodeCount, 0)
	var total int64
	for {
		var row errorCodeRow
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading error codes results: %w", err)
		}
		data = append(data, &model.ErrorCodeCount{
			ErrorCode:    row.ErrorCode,
			ErrorMessage: nullStringPtr(row.ErrorMessage),
			Total:        row.Total,
		})
		total += row.Total
	}

	return &model.ErrorCodesResult{Data: data, Total: total}, nil
}
