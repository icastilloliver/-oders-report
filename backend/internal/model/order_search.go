package model

// OrderSearchLine es una línea (SKU) de una orden en FAC_EDD_ORDERS_TRN. La
// mayoría de las columnas pueden venir NULL desde BigQuery, así que se
// modelan como punteros para que se serialicen como `null` en JSON, igual
// que el driver de Node. El repositorio se encarga de convertir los tipos
// Null* de BigQuery a estos punteros.
type OrderSearchLine struct {
	OrderNumber             string  `json:"orderNumber"`
	SKU                     *string `json:"sku"`
	Quantity                *int64  `json:"quantity"`
	Origen                  *string `json:"origen"`
	StoreSelected           *string `json:"storeSelected"`
	FulfillmentType         *string `json:"fulfillmentType"`
	ProductType             *string `json:"productType"`
	Company                 *string `json:"company"`
	Channel                 *string `json:"channel"`
	MarketPlace             *string `json:"marketPlace"`
	PaymentMethod           *string `json:"paymentMethod"`
	ZipCode                 *string `json:"zipCode"`
	DestinationCity         *string `json:"destinationCity"`
	DestinationMunicipality *string `json:"destinationMunicipality"`
	DestinationSuburb       *string `json:"destinationSuburb"`
	DestinationStreet       *string `json:"destinationStreet"`
	CreatedAt               *string `json:"createdAt"`
	EDD1                    *string `json:"edd1"`
	EDD2                    *string `json:"edd2"`
	EstimatedDeliveryLabel  *string `json:"estimatedDeliveryLabel"`
	Plan                    *string `json:"plan"`
	HasError                *string `json:"hasError"`
	ErrorCode               *string `json:"errorCode"`
	ErrorMessage            *string `json:"errorMessage"`
	IsOk                    *string `json:"isOk"`
	Ticket                  *string `json:"ticket"`
	RecordID                *string `json:"recordId"`
	TipoEntrega             string  `json:"tipoEntrega"`
}
