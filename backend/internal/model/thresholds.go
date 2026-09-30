package model

// Thresholds son los umbrales de alertamiento de una compañía: porcentaje
// mínimo aceptable de Plan A y máximos de Plan B / Error. Un puntero nil
// significa "sin umbral configurado" para ese plan; Enabled pausa o activa
// el alertamiento completo sin perder la configuración.
type Thresholds struct {
	Company   string   `json:"company"`
	PlanAMin  *float64 `json:"planAMin"`
	PlanBMax  *float64 `json:"planBMax"`
	ErrorMax  *float64 `json:"errorMax"`
	Enabled   bool     `json:"enabled"`
	UpdatedAt string   `json:"updatedAt,omitempty"`
}
