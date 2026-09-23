package repository

import (
	"context"
	"errors"
	"fmt"

	"edd-panel-backend/internal/model"

	"cloud.google.com/go/bigquery"
	"google.golang.org/api/iterator"
)

type channelCountBQ struct {
	Channel string `bigquery:"channel"`
	Total   int64  `bigquery:"total"`
	Errores int64  `bigquery:"errores"`
}

// GetChannelBreakdown reparte las líneas del rango por canal (channel), con
// los mismos filtros que el resto de la vista para que los % cuadren con los
// KPIs; incluye los errores por canal para mostrar la tasa de cada uno.
func (o *Orders) GetChannelBreakdown(
	ctx context.Context,
	company, productType, fulfillmentType, marketPlace, startDate, endDate string,
	hourStart, hourEnd int,
) ([]*model.ChannelCount, error) {
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

	var filterHour string
	filterHour, params = hourFilter(hourStart, hourEnd, params)

	query := fmt.Sprintf(`
		WITH base AS (
			SELECT
				IFNULL(NULLIF(TRIM(channel), ''), 'SIN CANAL') AS channel,
				%s AS clasificacion
			FROM `+"`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_ORDERS_TRN`"+`
			WHERE company = @company
				%s
				%s
				%s
				%s
				AND ingestionTimestamp >= TIMESTAMP(@start, 'America/Mexico_City')
				AND ingestionTimestamp <  TIMESTAMP(@end,   'America/Mexico_City')
		)
		SELECT
			channel,
			COUNT(*)                         AS total,
			COUNTIF(clasificacion = 'Error') AS errores
		FROM base
		GROUP BY channel
		ORDER BY total DESC
	`, clasificacionSQL, filterProductType, filterFulfillment, filterMarketplace, filterHour)

	q := o.client.Query(query)
	q.Parameters = params

	it, err := q.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("running channel breakdown query: %w", err)
	}

	data := make([]*model.ChannelCount, 0)
	for {
		var row channelCountBQ
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading channel breakdown: %w", err)
		}
		data = append(data, &model.ChannelCount{Channel: row.Channel, Total: row.Total, Errores: row.Errores})
	}
	return data, nil
}
