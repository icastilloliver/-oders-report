package model

type OrdersSummary struct {
	Fecha string `bigquery:"Fecha" json:"Fecha"`
	PlanA int    `bigquery:"Plan_A" json:"Plan_A"`
	PlanB int    `bigquery:"Plan_B" json:"Plan_B"`
	Error int    `bigquery:"Error" json:"Error"`
	Total int    `bigquery:"Total" json:"Total"`
}
