package services

import (
	"context"
	"errors"
	"strings"

	"edd-panel-backend/internal/model"
)

// Sentinels del módulo de umbrales de alertamiento.
var (
	ErrThresholdRango = errors.New("umbral inválido: usa porcentajes entre 0 y 100")
	ErrThresholdVacio = errors.New("configura al menos un umbral (Plan A, Plan B o Error)")
)

// GetThresholds regresa la configuración de umbrales de la compañía
// (nil si nunca se ha configurado — el front lo trata como "sin umbrales").
func (o *OrdersService) GetThresholds(ctx context.Context, company string) (*model.Thresholds, error) {
	company = strings.ToUpper(strings.TrimSpace(company))
	if company == "" {
		company = "LP"
	}
	return o.order.GetThresholds(ctx, company)
}

// SaveThresholds valida y guarda (upsert por compañía) los umbrales.
func (o *OrdersService) SaveThresholds(ctx context.Context, t *model.Thresholds) (*model.Thresholds, error) {
	t.Company = strings.ToUpper(strings.TrimSpace(t.Company))
	if t.Company == "" {
		t.Company = "LP"
	}
	for _, p := range []*float64{t.PlanAMin, t.PlanBMax, t.ErrorMax} {
		if p != nil && (*p < 0 || *p > 100) {
			return nil, ErrThresholdRango
		}
	}
	if t.PlanAMin == nil && t.PlanBMax == nil && t.ErrorMax == nil {
		return nil, ErrThresholdVacio
	}
	if err := o.order.UpsertThresholds(ctx, t); err != nil {
		return nil, err
	}
	// Regresa la fila ya guardada (trae updated_at formateado en CDMX) para
	// que el front no pierda "última actualización" justo tras guardar.
	saved, err := o.order.GetThresholds(ctx, t.Company)
	if err != nil || saved == nil {
		return t, nil // el guardado fue exitoso; el releído es cosmético
	}
	return saved, nil
}
