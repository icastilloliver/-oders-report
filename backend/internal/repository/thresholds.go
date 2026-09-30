package repository

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"edd-panel-backend/internal/model"

	"cloud.google.com/go/bigquery"
	"google.golang.org/api/iterator"
)

// Los umbrales viven junto a las incidencias, en el proyecto propio del
// dashboard (no en el dataset corporativo de solo lectura). Una fila por
// compañía; DML para que el upsert se refleje al instante sin pelearse con
// el streaming buffer de BigQuery.
const thresholdsTable = "`fechaestimadaentregaprod.alltables.dashboard_thresholds`"

var (
	ensureThresholdsMu   sync.Mutex
	thresholdsTableReady bool
)

// ensureThresholdsTable crea la tabla si no existe (idempotente). No usa
// sync.Once a propósito: si el primer intento falla (error transitorio de
// BigQuery, ctx cancelado), el siguiente request debe poder reintentar en
// lugar de quedar quemado hasta reiniciar el proceso.
func (o *Orders) ensureThresholdsTable(ctx context.Context) error {
	ensureThresholdsMu.Lock()
	defer ensureThresholdsMu.Unlock()
	if thresholdsTableReady {
		return nil
	}
	q := o.client.Query(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS %s (
			company    STRING    NOT NULL, -- una fila por compañía (LP, SB, GAP…)
			plan_a_min FLOAT64,            -- pct mínimo de Plan A; NULL = sin umbral
			plan_b_max FLOAT64,            -- pct máximo de Plan B
			error_max  FLOAT64,            -- pct máximo de Error
			enabled    BOOL      NOT NULL,
			updated_at TIMESTAMP NOT NULL
		)
	`, thresholdsTable))
	if _, err := runDML(ctx, q); err != nil {
		return err
	}
	thresholdsTableReady = true
	return nil
}

type thresholdsRowBQ struct {
	Company   string               `bigquery:"company"`
	PlanAMin  bigquery.NullFloat64 `bigquery:"plan_a_min"`
	PlanBMax  bigquery.NullFloat64 `bigquery:"plan_b_max"`
	ErrorMax  bigquery.NullFloat64 `bigquery:"error_max"`
	Enabled   bool                 `bigquery:"enabled"`
	UpdatedAt string               `bigquery:"updated_at"`
}

// GetThresholds regresa la configuración de la compañía, o nil (sin error)
// si nunca se ha guardado una.
func (o *Orders) GetThresholds(ctx context.Context, company string) (*model.Thresholds, error) {
	if err := o.ensureThresholdsTable(ctx); err != nil {
		return nil, fmt.Errorf("ensuring thresholds table: %w", err)
	}

	q := o.client.Query(fmt.Sprintf(`
		SELECT
			company, plan_a_min, plan_b_max, error_max, enabled,
			FORMAT_TIMESTAMP('%%Y-%%m-%%d %%H:%%M', updated_at, 'America/Mexico_City') AS updated_at
		FROM %s
		WHERE company = @company
		LIMIT 1
	`, thresholdsTable))
	q.Parameters = []bigquery.QueryParameter{{Name: "company", Value: company}}

	it, err := q.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("running thresholds query: %w", err)
	}

	var row thresholdsRowBQ
	err = it.Next(&row)
	if errors.Is(err, iterator.Done) {
		return nil, nil // aún sin configuración para esta compañía
	}
	if err != nil {
		return nil, fmt.Errorf("reading thresholds: %w", err)
	}

	t := &model.Thresholds{Company: row.Company, Enabled: row.Enabled, UpdatedAt: row.UpdatedAt}
	if row.PlanAMin.Valid {
		v := row.PlanAMin.Float64
		t.PlanAMin = &v
	}
	if row.PlanBMax.Valid {
		v := row.PlanBMax.Float64
		t.PlanBMax = &v
	}
	if row.ErrorMax.Valid {
		v := row.ErrorMax.Float64
		t.ErrorMax = &v
	}
	return t, nil
}

// UpsertThresholds inserta o actualiza (MERGE) la fila de la compañía.
func (o *Orders) UpsertThresholds(ctx context.Context, t *model.Thresholds) error {
	if err := o.ensureThresholdsTable(ctx); err != nil {
		return fmt.Errorf("ensuring thresholds table: %w", err)
	}

	q := o.client.Query(fmt.Sprintf(`
		MERGE %s T
		USING (SELECT @company AS company) S
		ON T.company = S.company
		WHEN MATCHED THEN UPDATE SET
			plan_a_min = @planAMin,
			plan_b_max = @planBMax,
			error_max  = @errorMax,
			enabled    = @enabled,
			updated_at = CURRENT_TIMESTAMP()
		WHEN NOT MATCHED THEN
			INSERT (company, plan_a_min, plan_b_max, error_max, enabled, updated_at)
			VALUES (@company, @planAMin, @planBMax, @errorMax, @enabled, CURRENT_TIMESTAMP())
	`, thresholdsTable))

	toNull := func(p *float64) bigquery.NullFloat64 {
		if p == nil {
			return bigquery.NullFloat64{}
		}
		return bigquery.NullFloat64{Float64: *p, Valid: true}
	}
	q.Parameters = []bigquery.QueryParameter{
		{Name: "company", Value: t.Company},
		{Name: "planAMin", Value: toNull(t.PlanAMin)},
		{Name: "planBMax", Value: toNull(t.PlanBMax)},
		{Name: "errorMax", Value: toNull(t.ErrorMax)},
		{Name: "enabled", Value: t.Enabled},
	}
	if _, err := runDML(ctx, q); err != nil {
		return fmt.Errorf("upserting thresholds: %w", err)
	}
	return nil
}
