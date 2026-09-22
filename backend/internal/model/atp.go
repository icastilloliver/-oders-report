package model

import "encoding/json"

// AtpDecommRow es una fila clasificada como Error del query de decomm: la
// candidata a validar disponibilidad (ATP) contra el OMS de Suburbia en la
// vista Validación ATP. quantity y zipCode viajan como string para conservar
// ceros a la izquierda y el shape que ya consume el frontend.
type AtpDecommRow struct {
	RecordID        string  `json:"recordId"`
	OrderNumber     string  `json:"orderNumber"`
	Sku             string  `json:"sku"`
	Quantity        string  `json:"quantity"`
	ZipCode         string  `json:"zipCode"`
	DestinationCity *string `json:"destinationCity"`
	Channel         *string `json:"channel"`
	FulfillmentType *string `json:"fulfillmentType"`
	ProductType     *string `json:"productType"`
	CreatedAt       *string `json:"createdAt"`
	ErrorCode       *string `json:"errorCode"`
	ErrorMessage    *string `json:"errorMessage"`
}

// FlexString acepta string o número JSON (el contrato del Express original
// era tolerante: parseInt/String sobre lo que llegara). OJO: no usar
// json.Number en su lugar — un CP "01000" como número sería JSON inválido.
type FlexString string

func (f *FlexString) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		*f = ""
		return nil
	}
	if len(b) > 0 && b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		*f = FlexString(s)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(b, &n); err != nil {
		return err
	}
	*f = FlexString(n.String())
	return nil
}

// AtpValidateItem es una combinación SKU + cantidad + CP a consultar en OMS.
type AtpValidateItem struct {
	Sku      string     `json:"sku"`
	Quantity FlexString `json:"quantity"`
	ZipCode  FlexString `json:"zipCode"`
}

// AtpValidateResult replica el resultado por item que consume la vista:
// CORRECTO | NOT_ENOUGH_PRODUCT_CHOICES | TIMEOUT | OTRO_ERROR.
type AtpValidateResult struct {
	Sku           string  `json:"sku"`
	SkuConsultado string  `json:"skuConsultado"`
	Quantity      string  `json:"quantity"`
	ZipCode       string  `json:"zipCode"`
	Status        string  `json:"status"`
	ErrorCode     string  `json:"errorCode"`
	ErrorMessage  string  `json:"errorMessage"`
	ShipNode      string  `json:"shipNode"`
	DeliveryDate  string  `json:"deliveryDate"`
	HTTPStatus    *int    `json:"httpStatus"`
	Seconds       float64 `json:"seconds"`
}

// ErrorTrendDay y ErrorTrendCode alimentan la gráfica "Comportamiento diario
// de los errores": total/errores del día y desglose por causal.
type ErrorTrendDay struct {
	Fecha   string `json:"Fecha"`
	Total   int64  `json:"total"`
	Errores int64  `json:"errores"`
}

type ErrorTrendCode struct {
	Fecha     string `json:"Fecha"`
	ErrorCode string `json:"errorCode"`
	Total     int64  `json:"total"`
}

// FulfillmentSegment es un lado de la comparativa por tipo de surtido de LP
// Decomm (domicilio, cnc u otro): tamaño del segmento, sus errores y la
// composición por errorCode dentro de ellos.
type FulfillmentSegment struct {
	Total   int64             `json:"total"`
	Errores int64             `json:"errores"`
	Codes   []*ErrorCodeCount `json:"codes"`
}

// ChannelCount es el peso de un canal (APP/WEB/WAP/CSC…) dentro del rango y
// filtros activos, con sus errores para poder mostrar la tasa por canal.
type ChannelCount struct {
	Channel string `json:"channel"`
	Total   int64  `json:"total"`
	Errores int64  `json:"errores"`
}
