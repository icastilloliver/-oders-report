package repository

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"edd-panel-backend/internal/model"

	"cloud.google.com/go/bigquery"
	"cloud.google.com/go/civil"
	"google.golang.org/api/iterator"
)

// Las incidencias viven en el proyecto propio del dashboard (el de deploy),
// NO en el dataset corporativo de solo lectura. Se usan sentencias DML (no
// streaming inserts) para poder borrar de inmediato sin pelearse con el
// streaming buffer de BigQuery.
const incidentsTable = "`fechaestimadaentregaprod.alltables.dashboard_incidents`"

var ensureIncidentsOnce sync.Once

// ensureIncidentsTable crea la tabla si no existe (idempotente, corre una
// vez por proceso).
func (o *Orders) ensureIncidentsTable(ctx context.Context) error {
	var err error
	ensureIncidentsOnce.Do(func() {
		q := o.client.Query(fmt.Sprintf(`
			CREATE TABLE IF NOT EXISTS %s (
				id          STRING NOT NULL,
				company     STRING NOT NULL,
				fecha       DATE   NOT NULL,
				fecha_fin   DATE, -- último día afectado; NULL = un solo día
				hora_inicio INT64,
				hora_fin    INT64,
				tipo        STRING NOT NULL, -- PLAN_B | ERROR | AMBOS
				titulo      STRING NOT NULL,
				descripcion STRING,
				created_at  TIMESTAMP NOT NULL
			)
		`, incidentsTable))
		if _, err = runDML(ctx, q); err != nil {
			return
		}
		// Migraciones para tablas creadas antes (multi-día y color).
		alter := o.client.Query(fmt.Sprintf(
			"ALTER TABLE %s ADD COLUMN IF NOT EXISTS fecha_fin DATE, ADD COLUMN IF NOT EXISTS color STRING",
			incidentsTable))
		_, err = runDML(ctx, alter)
	})
	return err
}

func runDML(ctx context.Context, q *bigquery.Query) (*bigquery.JobStatus, error) {
	job, err := q.Run(ctx)
	if err != nil {
		return nil, err
	}
	status, err := job.Wait(ctx)
	if err != nil {
		return nil, err
	}
	return status, status.Err()
}

type incidentRowBQ struct {
	ID          string              `bigquery:"id"`
	Company     string              `bigquery:"company"`
	Fecha       string              `bigquery:"fecha"`
	FechaFin    bigquery.NullString `bigquery:"fecha_fin"`
	HoraInicio  bigquery.NullInt64  `bigquery:"hora_inicio"`
	HoraFin     bigquery.NullInt64  `bigquery:"hora_fin"`
	Tipo        string              `bigquery:"tipo"`
	Color       bigquery.NullString `bigquery:"color"`
	Titulo      string              `bigquery:"titulo"`
	Descripcion bigquery.NullString `bigquery:"descripcion"`
	CreatedAt   string              `bigquery:"created_at"`
}

// ListIncidents regresa las incidencias de la compañía que caen en el rango
// [start, end) — mismo convenio de fin exclusivo que el resto de la app.
func (o *Orders) ListIncidents(ctx context.Context, company, startDate, endDate string) ([]*model.Incident, error) {
	if err := o.ensureIncidentsTable(ctx); err != nil {
		return nil, fmt.Errorf("ensuring incidents table: %w", err)
	}

	// Solape de rangos: una incidencia [fecha, fecha_fin] entra si toca
	// cualquier día de [start, end), aunque haya empezado antes del rango.
	q := o.client.Query(fmt.Sprintf(`
		SELECT
			id, company, CAST(fecha AS STRING) AS fecha,
			CAST(fecha_fin AS STRING) AS fecha_fin,
			hora_inicio, hora_fin, tipo, color, titulo, descripcion,
			FORMAT_TIMESTAMP('%%Y-%%m-%%d %%H:%%M', created_at, 'America/Mexico_City') AS created_at
		FROM %s
		WHERE company = @company
			AND fecha < @end
			AND IFNULL(fecha_fin, fecha) >= @start
		ORDER BY fecha, IFNULL(hora_inicio, 0), created_at
	`, incidentsTable))
	q.Parameters = []bigquery.QueryParameter{
		{Name: "company", Value: company},
		{Name: "start", Value: startDate},
		{Name: "end", Value: endDate},
	}

	it, err := q.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("running incidents query: %w", err)
	}

	out := make([]*model.Incident, 0)
	for {
		var row incidentRowBQ
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading incidents: %w", err)
		}
		inc := &model.Incident{
			ID:        row.ID,
			Company:   row.Company,
			Fecha:     row.Fecha,
			Tipo:      row.Tipo,
			Titulo:    row.Titulo,
			CreatedAt: row.CreatedAt,
		}
		if row.FechaFin.Valid {
			ff := row.FechaFin.StringVal
			inc.FechaFin = &ff
		}
		if row.HoraInicio.Valid {
			h := int(row.HoraInicio.Int64)
			inc.HoraInicio = &h
		}
		if row.HoraFin.Valid {
			h := int(row.HoraFin.Int64)
			inc.HoraFin = &h
		}
		if row.Descripcion.Valid {
			inc.Descripcion = row.Descripcion.StringVal
		}
		if row.Color.Valid {
			inc.Color = row.Color.StringVal
		}
		out = append(out, inc)
	}
	return out, nil
}

// CreateIncident inserta vía DML (INSERT ... VALUES) para que el registro
// sea borrable de inmediato.
func (o *Orders) CreateIncident(ctx context.Context, inc *model.Incident) error {
	if err := o.ensureIncidentsTable(ctx); err != nil {
		return fmt.Errorf("ensuring incidents table: %w", err)
	}

	q := o.client.Query(fmt.Sprintf(`
		INSERT INTO %s (id, company, fecha, fecha_fin, hora_inicio, hora_fin, tipo, color, titulo, descripcion, created_at)
		VALUES (@id, @company, @fecha, @fechaFin, @horaInicio, @horaFin, @tipo, @color, @titulo, @descripcion, CURRENT_TIMESTAMP())
	`, incidentsTable))

	var ff bigquery.NullDate
	if inc.FechaFin != nil {
		if d, derr := civil.ParseDate(*inc.FechaFin); derr == nil {
			ff = bigquery.NullDate{Date: d, Valid: true}
		}
	}
	var hi, hf bigquery.NullInt64
	if inc.HoraInicio != nil {
		hi = bigquery.NullInt64{Int64: int64(*inc.HoraInicio), Valid: true}
	}
	if inc.HoraFin != nil {
		hf = bigquery.NullInt64{Int64: int64(*inc.HoraFin), Valid: true}
	}
	q.Parameters = []bigquery.QueryParameter{
		{Name: "id", Value: inc.ID},
		{Name: "company", Value: inc.Company},
		{Name: "fecha", Value: inc.Fecha},
		{Name: "fechaFin", Value: ff},
		{Name: "horaInicio", Value: hi},
		{Name: "horaFin", Value: hf},
		{Name: "tipo", Value: inc.Tipo},
		{Name: "color", Value: inc.Color},
		{Name: "titulo", Value: inc.Titulo},
		{Name: "descripcion", Value: inc.Descripcion},
	}
	_, err := runDML(ctx, q)
	if err != nil {
		return fmt.Errorf("inserting incident: %w", err)
	}
	return nil
}

// UpdateIncident actualiza todos los campos editables de una incidencia;
// regresa cuántas filas afectó (0 = no existe).
func (o *Orders) UpdateIncident(ctx context.Context, inc *model.Incident) (int64, error) {
	if err := o.ensureIncidentsTable(ctx); err != nil {
		return 0, fmt.Errorf("ensuring incidents table: %w", err)
	}

	q := o.client.Query(fmt.Sprintf(`
		UPDATE %s SET
			fecha = @fecha,
			fecha_fin = @fechaFin,
			hora_inicio = @horaInicio,
			hora_fin = @horaFin,
			tipo = @tipo,
			color = @color,
			titulo = @titulo,
			descripcion = @descripcion
		WHERE id = @id
	`, incidentsTable))

	var ff bigquery.NullDate
	if inc.FechaFin != nil {
		if d, derr := civil.ParseDate(*inc.FechaFin); derr == nil {
			ff = bigquery.NullDate{Date: d, Valid: true}
		}
	}
	var hi, hf bigquery.NullInt64
	if inc.HoraInicio != nil {
		hi = bigquery.NullInt64{Int64: int64(*inc.HoraInicio), Valid: true}
	}
	if inc.HoraFin != nil {
		hf = bigquery.NullInt64{Int64: int64(*inc.HoraFin), Valid: true}
	}
	q.Parameters = []bigquery.QueryParameter{
		{Name: "id", Value: inc.ID},
		{Name: "fecha", Value: inc.Fecha},
		{Name: "fechaFin", Value: ff},
		{Name: "horaInicio", Value: hi},
		{Name: "horaFin", Value: hf},
		{Name: "tipo", Value: inc.Tipo},
		{Name: "color", Value: inc.Color},
		{Name: "titulo", Value: inc.Titulo},
		{Name: "descripcion", Value: inc.Descripcion},
	}
	status, err := runDML(ctx, q)
	if err != nil {
		return 0, fmt.Errorf("updating incident: %w", err)
	}
	if qs, ok := status.Statistics.Details.(*bigquery.QueryStatistics); ok {
		return qs.NumDMLAffectedRows, nil
	}
	return 0, nil
}

// DeleteIncident borra por id; regresa cuántas filas afectó para que el
// servicio distinga "no existía".
func (o *Orders) DeleteIncident(ctx context.Context, id string) (int64, error) {
	if err := o.ensureIncidentsTable(ctx); err != nil {
		return 0, fmt.Errorf("ensuring incidents table: %w", err)
	}

	q := o.client.Query(fmt.Sprintf(`DELETE FROM %s WHERE id = @id`, incidentsTable))
	q.Parameters = []bigquery.QueryParameter{{Name: "id", Value: id}}
	status, err := runDML(ctx, q)
	if err != nil {
		return 0, fmt.Errorf("deleting incident: %w", err)
	}
	if qs, ok := status.Statistics.Details.(*bigquery.QueryStatistics); ok {
		return qs.NumDMLAffectedRows, nil
	}
	return 0, nil
}
