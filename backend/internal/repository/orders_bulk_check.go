package repository

import (
	"context"
	"edd-panel-backend/internal/model"
	"errors"
	"fmt"

	"cloud.google.com/go/bigquery"
	"google.golang.org/api/iterator"
)

type bulkCheckRow struct {
	OrderNumber     bigquery.NullString `bigquery:"orderNumber"`
	SKU             bigquery.NullString `bigquery:"sku"`
	Quantity        bigquery.NullInt64  `bigquery:"quantity"`
	Origen          bigquery.NullString `bigquery:"origen"`
	StoreSelected   bigquery.NullString `bigquery:"storeSelected"`
	FulfillmentType bigquery.NullString `bigquery:"fulfillmentType"`
	ProductType     bigquery.NullString `bigquery:"productType"`
	Company         bigquery.NullString `bigquery:"company"`
	Channel         bigquery.NullString `bigquery:"channel"`
	PaymentMethod   bigquery.NullString `bigquery:"paymentMethod"`
	ZipCode         bigquery.NullString `bigquery:"zipCode"`
	DestinationCity bigquery.NullString `bigquery:"destinationCity"`
	CreatedAt       bigquery.NullString `bigquery:"createdAt"`
	EDD1            bigquery.NullString `bigquery:"edd1"`
	EDD2            bigquery.NullString `bigquery:"edd2"`
	Plan            bigquery.NullString `bigquery:"plan"`
	HasError        bigquery.NullString `bigquery:"hasError"`
	ErrorCode       bigquery.NullString `bigquery:"errorCode"`
	ErrorMessage    bigquery.NullString `bigquery:"errorMessage"`
	Ticket          bigquery.NullString `bigquery:"ticket"`
	RecordID        bigquery.NullString `bigquery:"recordId"`
}

func (r bulkCheckRow) toModel() *model.BulkCheckDetailLine {
	return &model.BulkCheckDetailLine{
		OrderNumber:     r.OrderNumber.StringVal,
		SKU:             nullStringPtr(r.SKU),
		Quantity:        nullInt64Ptr(r.Quantity),
		Origen:          nullStringPtr(r.Origen),
		StoreSelected:   nullStringPtr(r.StoreSelected),
		FulfillmentType: nullStringPtr(r.FulfillmentType),
		ProductType:     nullStringPtr(r.ProductType),
		Company:         nullStringPtr(r.Company),
		Channel:         nullStringPtr(r.Channel),
		PaymentMethod:   nullStringPtr(r.PaymentMethod),
		ZipCode:         nullStringPtr(r.ZipCode),
		DestinationCity: nullStringPtr(r.DestinationCity),
		CreatedAt:       nullStringPtr(r.CreatedAt),
		EDD1:            nullStringPtr(r.EDD1),
		EDD2:            nullStringPtr(r.EDD2),
		Plan:            nullStringPtr(r.Plan),
		HasError:        nullStringPtr(r.HasError),
		ErrorCode:       nullStringPtr(r.ErrorCode),
		ErrorMessage:    nullStringPtr(r.ErrorMessage),
		Ticket:          nullStringPtr(r.Ticket),
		RecordID:        nullStringPtr(r.RecordID),
	}
}

// BulkCheckOrders busca en FAC_EDD_ORDERS_TRN (últimos 180 días, todas las
// compañías) todas las líneas cuyo orderNumber esté entre candidates. El
// caller (service) arma candidates a partir de los IDs solicitados más sus
// variantes "sin prefijo" (ver bareID), y hace el agrupamiento/veredicto por
// orden a partir de las filas que regresa este método.
func (o *Orders) BulkCheckOrders(ctx context.Context, candidates []string) ([]*model.BulkCheckDetailLine, error) {
	const query = `
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
			paymentMethod,
			zipCode,
			destinationCity,
			FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', createdAt, 'America/Mexico_City') AS createdAt,
			CAST(edd1 AS STRING) AS edd1,
			CAST(edd2 AS STRING) AS edd2,
			plan,
			CAST(hasError AS STRING) AS hasError,
			errorCode,
			errorMessage,
			ticket,
			recordId
		FROM ` + "`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_ORDERS_TRN`" + `
		WHERE ingestionTimestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 180 DAY)
			AND orderNumber IN UNNEST(@candidates)
		ORDER BY orderNumber, edd1 NULLS LAST, sku
	`

	q := o.client.Query(query)
	q.Parameters = []bigquery.QueryParameter{
		{Name: "candidates", Value: candidates},
	}

	it, err := q.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("running bulk check query: %w", err)
	}

	lines := make([]*model.BulkCheckDetailLine, 0)
	for {
		var row bulkCheckRow
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading bulk check results: %w", err)
		}
		lines = append(lines, row.toModel())
	}

	return lines, nil
}
