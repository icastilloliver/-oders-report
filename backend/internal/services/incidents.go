package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"

	"edd-panel-backend/internal/model"
)

// Sentinels de la bitácora de incidencias.
var (
	ErrIncidentTitulo   = errors.New("el título es obligatorio (máximo 120 caracteres)")
	ErrIncidentTipo     = errors.New("tipo inválido: usa PLAN_B, ERROR o AMBOS")
	ErrIncidentHoras    = errors.New("horas inválidas (0-23; inicio y fin en pareja)")
	ErrIncidentNotFound = errors.New("la incidencia no existe")
	ErrIncidentID       = errors.New("id inválido")
	ErrIncidentRango    = errors.New("la fecha fin no puede ser anterior a la fecha de inicio")
	ErrIncidentColor    = errors.New("color inválido: usa formato #rrggbb")
)

var incidentColorRegex = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

var incidentIDRegex = regexp.MustCompile(`^[a-f0-9]{32}$`)

func newIncidentID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ListIncidents regresa las incidencias del rango [start, end) de la compañía.
func (o *OrdersService) ListIncidents(ctx context.Context, company, start, end string) ([]*model.Incident, error) {
	if company == "" {
		company = "LP"
	}
	if err := validateRealDates(start, end); err != nil {
		return nil, err
	}
	return o.order.ListIncidents(ctx, company, start, end)
}

// validateIncidentFields aplica las reglas comunes de alta y edición.
func validateIncidentFields(inc *model.Incident) error {
	if err := validateRealDates(inc.Fecha); err != nil {
		return err
	}
	// Fin opcional: si viene, debe ser fecha real y no anterior al inicio.
	if inc.FechaFin != nil {
		if *inc.FechaFin == "" || *inc.FechaFin == inc.Fecha {
			inc.FechaFin = nil // un solo día
		} else {
			if err := validateRealDates(*inc.FechaFin); err != nil {
				return err
			}
			if *inc.FechaFin < inc.Fecha {
				return ErrIncidentRango
			}
		}
	}
	inc.Titulo = strings.TrimSpace(inc.Titulo)
	if inc.Titulo == "" || len([]rune(inc.Titulo)) > 120 {
		return ErrIncidentTitulo
	}
	inc.Descripcion = strings.TrimSpace(inc.Descripcion)
	if len([]rune(inc.Descripcion)) > 1000 {
		inc.Descripcion = string([]rune(inc.Descripcion)[:1000])
	}
	switch inc.Tipo {
	case "PLAN_B", "ERROR", "AMBOS":
	default:
		return ErrIncidentTipo
	}
	inc.Color = strings.TrimSpace(inc.Color)
	if inc.Color != "" && !incidentColorRegex.MatchString(inc.Color) {
		return ErrIncidentColor
	}
	// Horas opcionales, pero en pareja y 0-23 (CDMX). Puede cruzar medianoche.
	if (inc.HoraInicio == nil) != (inc.HoraFin == nil) {
		return ErrIncidentHoras
	}
	if inc.HoraInicio != nil {
		if *inc.HoraInicio < 0 || *inc.HoraInicio > 23 || *inc.HoraFin < 0 || *inc.HoraFin > 23 {
			return ErrIncidentHoras
		}
	}
	return nil
}

// CreateIncident valida y registra una afectación manual.
func (o *OrdersService) CreateIncident(ctx context.Context, inc *model.Incident) (*model.Incident, error) {
	inc.Company = strings.ToUpper(strings.TrimSpace(inc.Company))
	if inc.Company == "" {
		inc.Company = "LP"
	}
	if err := validateIncidentFields(inc); err != nil {
		return nil, err
	}
	inc.ID = newIncidentID()
	if err := o.order.CreateIncident(ctx, inc); err != nil {
		return nil, err
	}
	return inc, nil
}

// UpdateIncident valida y actualiza una incidencia existente.
func (o *OrdersService) UpdateIncident(ctx context.Context, inc *model.Incident) (*model.Incident, error) {
	if !incidentIDRegex.MatchString(inc.ID) {
		return nil, ErrIncidentID
	}
	if err := validateIncidentFields(inc); err != nil {
		return nil, err
	}
	n, err := o.order.UpdateIncident(ctx, inc)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrIncidentNotFound
	}
	return inc, nil
}

// DeleteIncident borra una incidencia por id.
func (o *OrdersService) DeleteIncident(ctx context.Context, id string) error {
	if !incidentIDRegex.MatchString(id) {
		return ErrIncidentID
	}
	n, err := o.order.DeleteIncident(ctx, id)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrIncidentNotFound
	}
	return nil
}
