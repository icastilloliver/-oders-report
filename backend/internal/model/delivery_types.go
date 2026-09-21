package model

type DeliveryTypeByDay struct {
	Fecha        string `bigquery:"Fecha" json:"Fecha"`
	Flash        int    `bigquery:"Flash" json:"Flash"`
	SiguienteDia int    `bigquery:"Siguiente_Dia" json:"Siguiente_Dia"`
	Estandar     int    `bigquery:"Estandar" json:"Estandar"`
	SinEDD       int    `bigquery:"Sin_EDD" json:"Sin_EDD"`
	Total        int    `bigquery:"Total" json:"Total"`
}

type DeliveryTypeStore struct {
	Tienda       string `bigquery:"tienda" json:"tienda"`
	Asignaciones int    `bigquery:"asignaciones" json:"asignaciones"`
}

type DeliveryTypeTotals struct {
	Flash        int `json:"flash"`
	SiguienteDia int `json:"siguienteDia"`
	Estandar     int `json:"estandar"`
	SinEDD       int `json:"sinEDD"`
	Total        int `json:"total"`
}

type DeliveryTypesResult struct {
	ByDay  []*DeliveryTypeByDay `json:"byDay"`
	Stores []*DeliveryTypeStore `json:"stores"`
	Totals DeliveryTypeTotals   `json:"totals"`
}
