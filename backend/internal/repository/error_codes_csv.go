package repository

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"

	"cloud.google.com/go/bigquery"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
	"google.golang.org/api/iterator"
)

// ErrorCodesCSVMaxRows y ErrorCodesCSVMaxCodes replican los topes que ya
// tenía server.js: un CSV truncado en silencio se lee como si fuera el
// universo completo, así que el corte se anuncia (ver Truncated en el
// resultado) en vez de dejarlo pasar desapercibido.
const (
	ErrorCodesCSVMaxRows  = 100000
	ErrorCodesCSVMaxCodes = 60
)

// ErrorCodesCSVParams agrupa los filtros del export de un segmento de la
// dona de errorCode, ya validados por el servicio.
type ErrorCodesCSVParams struct {
	Start           string
	End             string
	Company         string
	ProductType     string
	FulfillmentType string
	// MarketPlace filtra por tipo de producto ('true'|'false'); vacío = todos.
	MarketPlace string
	// Channel filtra por canal de venta ya normalizado a mayúsculas; vacío = todos.
	Channel string
	// Codes es la lista de errorCode normalizados a incluir. nil = todos.
	Codes []string
}

// GetErrorCodesCSV corre la misma clasificación que GetErrorCodes pero
// regresando las filas crudas (SELECT *) detrás de un segmento de la dona,
// en vez del conteo agregado. A diferencia de GetOrdersCSV (sin límite, por
// eso ese sí se transmite en streaming), esta consulta siempre tuvo un
// LIMIT acotado en server.js, así que se mantiene el patrón simple en
// memoria — con un tope de 100k filas no hace falta streaming.
func (o *Orders) GetErrorCodesCSV(ctx context.Context, p ErrorCodesCSVParams) (header []string, rows [][]string, truncated bool, err error) {
	params := []bigquery.QueryParameter{
		{Name: "company", Value: p.Company},
		{Name: "start", Value: fmt.Sprintf("%s 00:00:00", p.Start)},
		{Name: "end", Value: fmt.Sprintf("%s 00:00:00", p.End)},
	}

	var filterProductType string
	if p.ProductType != "" {
		filterProductType = "AND UPPER(TRIM(productType)) IN UNNEST(@productTypes)"
		params = append(params, bigquery.QueryParameter{Name: "productTypes", Value: productTypeVariants(p.ProductType)})
	}

	var filterFulfillment string
	if p.FulfillmentType != "" {
		filterFulfillment = "AND fulfillmentType = @fulfillmentType"
		params = append(params, bigquery.QueryParameter{Name: "fulfillmentType", Value: p.FulfillmentType})
	}

	var filterMarketplace string
	if p.MarketPlace != "" {
		filterMarketplace = "AND marketPlace = @marketPlace"
		params = append(params, bigquery.QueryParameter{Name: "marketPlace", Value: p.MarketPlace == "true"})
	}

	var filterChannel string
	if p.Channel != "" {
		filterChannel = "AND UPPER(TRIM(channel)) = @channel"
		params = append(params, bigquery.QueryParameter{Name: "channel", Value: p.Channel})
	}

	var filterCodes string
	if p.Codes != nil {
		filterCodes = "AND errorCodeNormalizado IN UNNEST(@codes)"
		params = append(params, bigquery.QueryParameter{Name: "codes", Value: p.Codes})
	}

	query := fmt.Sprintf(`
		WITH base AS (
			SELECT
				*,
				%s AS errorCodeNormalizado,
				CASE
					WHEN plan = 'B' THEN 'Plan B'
					WHEN plan = 'A' AND edd1 IS NOT NULL AND edd2 IS NOT NULL THEN 'Plan A'
					ELSE 'Error'
				END AS clasificacion
			FROM `+"`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_ORDERS_TRN`"+`
			WHERE company = @company
				%s
				%s
				%s
				%s
				AND ingestionTimestamp >= TIMESTAMP(@start, 'America/Mexico_City')
				AND ingestionTimestamp <  TIMESTAMP(@end,   'America/Mexico_City')
		)
		SELECT * FROM base
		WHERE clasificacion = 'Error'
			%s
		ORDER BY ingestionTimestamp
		LIMIT %d
	`, errorCodeNormSQL, filterProductType, filterFulfillment, filterMarketplace, filterChannel, filterCodes, ErrorCodesCSVMaxRows)

	q := o.client.Query(query)
	q.Parameters = params

	it, err := q.Read(ctx)
	if err != nil {
		return nil, nil, false, fmt.Errorf("running error codes csv query: %w", err)
	}

	data := make([][]string, 0)
	for {
		var row []bigquery.Value
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, nil, false, fmt.Errorf("reading error codes csv results: %w", err)
		}
		if header == nil {
			header = make([]string, len(it.Schema))
			for i, f := range it.Schema {
				header[i] = f.Name
			}
		}
		data = append(data, stringifyBQRow(row))
	}

	truncated = len(data) >= ErrorCodesCSVMaxRows
	return header, data, truncated, nil
}

var slugNonAlnumRegex = regexp.MustCompile(`[^a-zA-Z0-9]+`)

// stripAccents quita diacríticos (á -> a, ñ -> n, ü -> u, ...) vía
// descomposición NFD + remoción de marcas combinantes, igual que
// `.normalize('NFD').replace(/[̀-ͯ]/g, ”)` en JS.
var stripAccents = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)

// Slugify arma un nombre de archivo seguro a partir de una etiqueta de la
// dona (puerto de la función homónima en server.js): quita acentos,
// colapsa todo lo no alfanumérico a '-', recorta guiones en los extremos y
// limita a 60 caracteres. Si el resultado queda vacío, regresa fallback.
func Slugify(text, fallback string) string {
	if text == "" {
		return fallback
	}

	stripped, _, err := transform.String(stripAccents, text)
	if err != nil {
		stripped = text
	}

	slug := slugNonAlnumRegex.ReplaceAllString(stripped, "-")
	slug = strings.Trim(slug, "-")
	if len(slug) > 60 {
		slug = slug[:60]
	}

	if slug == "" {
		return fallback
	}
	return slug
}
