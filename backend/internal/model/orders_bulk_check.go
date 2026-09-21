package model

// BulkCheckDetailLine es una línea (SKU) encontrada en FAC_EDD_ORDERS_TRN al
// cotejar un lote de órdenes. Igual que en order-search, los campos que
// pueden venir NULL desde BigQuery se modelan como punteros.
type BulkCheckDetailLine struct {
	OrderNumber     string  `json:"orderNumber"`
	SKU             *string `json:"sku"`
	Quantity        *int64  `json:"quantity"`
	Origen          *string `json:"origen"`
	StoreSelected   *string `json:"storeSelected"`
	FulfillmentType *string `json:"fulfillmentType"`
	ProductType     *string `json:"productType"`
	Company         *string `json:"company"`
	Channel         *string `json:"channel"`
	PaymentMethod   *string `json:"paymentMethod"`
	ZipCode         *string `json:"zipCode"`
	DestinationCity *string `json:"destinationCity"`
	CreatedAt       *string `json:"createdAt"`
	EDD1            *string `json:"edd1"`
	EDD2            *string `json:"edd2"`
	Plan            *string `json:"plan"`
	HasError        *string `json:"hasError"`
	ErrorCode       *string `json:"errorCode"`
	ErrorMessage    *string `json:"errorMessage"`
	Ticket          *string `json:"ticket"`
	RecordID        *string `json:"recordId"`
}

// BulkCheckOrder es el veredicto agregado de una orden del lote: cuántas
// líneas trajo, cuántas con error, y el detalle crudo de cada una.
type BulkCheckOrder struct {
	OrderNumber    string                 `json:"orderNumber"`
	MatchedAs      *string                `json:"matchedAs"`
	Found          bool                   `json:"found"`
	Lines          int                    `json:"lines"`
	LinesWithError int                    `json:"linesWithError"`
	ErrorCodes     []string               `json:"errorCodes"`
	Company        *string                `json:"company"`
	Channel        *string                `json:"channel"`
	CreatedAt      *string                `json:"createdAt"`
	Plans          []string               `json:"plans"`
	Detail         []*BulkCheckDetailLine `json:"detail"`
	HasError       bool                   `json:"hasError"`
}

// BulkCheckSummary es el resumen agregado del lote completo.
type BulkCheckSummary struct {
	Requested            int            `json:"requested"`
	Invalid              int            `json:"invalid"`
	Found                int            `json:"found"`
	NotFound             int            `json:"notFound"`
	OrdersWithError      int            `json:"ordersWithError"`
	MatchedWithoutPrefix int            `json:"matchedWithoutPrefix"`
	TotalLines           int            `json:"totalLines"`
	LinesWithError       int            `json:"linesWithError"`
	ErrorCodeCounts      map[string]int `json:"errorCodeCounts"`
}

type BulkCheckResult struct {
	Orders  []*BulkCheckOrder `json:"orders"`
	Summary BulkCheckSummary  `json:"summary"`
}
