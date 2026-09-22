package repository

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"os"
	"strconv"
	"time"

	"cloud.google.com/go/bigquery"
	"cloud.google.com/go/civil"
	"google.golang.org/api/iterator"
)

// FulfillmentTypes son los únicos valores aceptados para el filtro de tipo
// de surtido (mismo catálogo que server.js).
var FulfillmentTypes = []string{"Liverpool_CNC_PICK_PACK", "Fulfillment_Type_Liverpool"}

// OrdersCSVType identifica cuál de las tres fuentes usar para el export.
type OrdersCSVType string

const (
	OrdersCSVTypeSummary OrdersCSVType = "summary"
	OrdersCSVTypeDecomm  OrdersCSVType = "decomm"
	OrdersCSVTypeRecalc  OrdersCSVType = "recalc"
)

// OrdersCSVParams agrupa los filtros del export, ya validados por el
// servicio (formato de fechas, tipo, fulfillmentType, marketPlace).
type OrdersCSVParams struct {
	Start           string
	End             string
	Company         string
	Type            OrdersCSVType
	ProductType     string
	FulfillmentType string
	MarketPlace     string
	Channel         string
}

// OrdersCSVPageSize fija el tamaño de página del RowIterator para que los
// flush hacia el cliente ocurran en fronteras predecibles, sin importar
// cuántas filas tenga el resultado.
const OrdersCSVPageSize = 2000

// OrdersCSVStream es un cursor de solo lectura sobre el resultado de
// GetOrdersCSV: entrega las filas una por una a medida que llegan de
// BigQuery, en vez de materializar el resultado completo en memoria. Sigue
// el mismo patrón que *sql.Rows — se llama Next() hasta que regrese false,
// y entre llamadas Row() da la fila actual — para que el caller (transport)
// pueda transmitir cada fila al cliente sin esperar a tenerlas todas.
type OrdersCSVStream struct {
	it         *bigquery.RowIterator
	header     []string
	totalRows  uint64
	pending    []string
	hasPending bool
	current    []string
	rowsRead   int64
	err        error
}

// Header regresa los nombres de columna (orden de SELECT *). nil si Empty().
func (s *OrdersCSVStream) Header() []string { return s.header }

// Empty indica que la consulta no encontró ninguna fila.
func (s *OrdersCSVStream) Empty() bool { return s.header == nil }

// TotalRows es el total reportado por BigQuery tras la primera página.
// Es una cifra "best effort" (el propio cliente documenta que puede venir
// en 0 justo después de una inserción reciente); el conteo confiable es
// RowsRead() una vez que el stream termina.
func (s *OrdersCSVStream) TotalRows() uint64 { return s.totalRows }

// RowsRead es cuántas filas se han entregado hasta el momento (o el total
// real transmitido, una vez que el stream terminó).
func (s *OrdersCSVStream) RowsRead() int64 { return s.rowsRead }

// Err regresa el error de lectura si Next() terminó por una falla distinta
// a agotar el resultado (iterator.Done no cuenta como error).
func (s *OrdersCSVStream) Err() error { return s.err }

// AtPageBoundary indica que ya se agotó la página actual del iterador: la
// siguiente llamada a Next() dispara una petición de red. Es el punto
// natural para hacer flush hacia el cliente.
func (s *OrdersCSVStream) AtPageBoundary() bool {
	return s.it.PageInfo().Remaining() == 0
}

// Next avanza el cursor. Regresa false al agotar el resultado o al fallar
// (revisar Err() después para distinguir ambos casos).
func (s *OrdersCSVStream) Next() bool {
	if s.err != nil {
		return false
	}
	if s.hasPending {
		s.current = s.pending
		s.pending = nil
		s.hasPending = false
		s.rowsRead++
		return true
	}

	var row []bigquery.Value
	err := s.it.Next(&row)
	if errors.Is(err, iterator.Done) {
		return false
	}
	if err != nil {
		s.err = fmt.Errorf("reading orders csv results: %w", err)
		return false
	}

	s.current = stringifyBQRow(row)
	s.rowsRead++
	return true
}

// Row regresa la fila actual, válida solo después de un Next() que haya
// regresado true.
func (s *OrdersCSVStream) Row() []string { return s.current }

// GetOrdersCSV corre la consulta correspondiente al tipo pedido (summary,
// decomm o recalc) y regresa un cursor sobre TODAS las filas encontradas
// —sin LIMIT ni tope de páginas—, para que el caller las transmita al
// cliente a medida que llegan en vez de esperar a tenerlas todas en
// memoria. Lee (peek) la primera fila antes de regresar: así se conoce el
// encabezado (it.Schema) y si el resultado viene vacío, sin haber
// comprometido ninguna respuesta HTTP todavía.
func (o *Orders) GetOrdersCSV(ctx context.Context, p OrdersCSVParams) (*OrdersCSVStream, error) {
	query, params, location, err := buildOrdersCSVQuery(p)
	if err != nil {
		return nil, err
	}

	q := o.client.Query(query)
	q.Parameters = params
	if location != "" {
		q.Location = location
	}

	it, err := q.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("running orders csv query: %w", err)
	}
	it.PageInfo().MaxSize = OrdersCSVPageSize

	stream := &OrdersCSVStream{it: it}

	var row []bigquery.Value
	err = it.Next(&row)
	if errors.Is(err, iterator.Done) {
		return stream, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading orders csv results: %w", err)
	}

	header := make([]string, len(it.Schema))
	for i, f := range it.Schema {
		header[i] = f.Name
	}

	stream.header = header
	stream.totalRows = it.TotalRows
	stream.pending = stringifyBQRow(row)
	stream.hasPending = true

	return stream, nil
}

func buildOrdersCSVQuery(p OrdersCSVParams) (string, []bigquery.QueryParameter, string, error) {
	params := []bigquery.QueryParameter{
		{Name: "start", Value: fmt.Sprintf("%s 00:00:00", p.Start)},
		{Name: "end", Value: fmt.Sprintf("%s 00:00:00", p.End)},
	}
	if p.FulfillmentType != "" {
		params = append(params, bigquery.QueryParameter{Name: "fulfillmentType", Value: p.FulfillmentType})
	}

	switch p.Type {
	case OrdersCSVTypeSummary:
		params = append(params,
			bigquery.QueryParameter{Name: "company", Value: p.Company},
			bigquery.QueryParameter{Name: "productTypes", Value: productTypeVariants(p.ProductType)},
		)

		var fulfillmentFilter string
		if p.FulfillmentType != "" {
			fulfillmentFilter = "AND JSON_EXTRACT_SCALAR(data, '$.fulfillmentType') = @fulfillmentType"
		}

		query := fmt.Sprintf(`
			WITH base AS (
				SELECT
					JSON_EXTRACT_SCALAR(data, '$.plan') AS plan_ext,
					JSON_EXTRACT_SCALAR(data, '$.edd1') AS edd1_ext,
					JSON_EXTRACT_SCALAR(data, '$.edd2') AS edd2_ext,
					*
				FROM `+"`fechaestimadaentregaprod.alltables.tables_raw_changelog`"+`
				WHERE JSON_EXTRACT_SCALAR(data, '$.company') = @company
					AND UPPER(TRIM(JSON_EXTRACT_SCALAR(data, '$.productType'))) IN UNNEST(@productTypes)
					%s
					AND timestamp >= TIMESTAMP(@start, 'America/Mexico_City')
					AND timestamp <  TIMESTAMP(@end,   'America/Mexico_City')
			),
			clasificado AS (
				SELECT *,
					CASE
						WHEN UPPER(plan_ext) = 'B' THEN 'Plan B'
						WHEN edd1_ext IS NOT NULL AND edd1_ext <> '' AND edd2_ext IS NOT NULL AND edd2_ext <> '' THEN 'Plan A'
						ELSE 'Error'
					END AS clasificacion
				FROM base
			)
			SELECT * EXCEPT(plan_ext, edd1_ext, edd2_ext) FROM clasificado WHERE clasificacion IN ('Error', 'Plan B')
		`, fulfillmentFilter)

		location := os.Getenv("BQ_LOCATION")
		if location == "" {
			location = "US"
		}
		return query, params, location, nil

	case OrdersCSVTypeDecomm:
		params = append(params, bigquery.QueryParameter{Name: "company", Value: p.Company})

		var filterProductType string
		if p.ProductType != "" {
			filterProductType = "AND UPPER(TRIM(productType)) IN UNNEST(@productTypes)"
			params = append(params, bigquery.QueryParameter{Name: "productTypes", Value: productTypeVariants(p.ProductType)})
		}

		var filterFulfillment string
		if p.FulfillmentType != "" {
			filterFulfillment = "AND fulfillmentType = @fulfillmentType"
			// Sin este append el filtro de surtido tronaba en BigQuery por
			// parámetro faltante (bug del port original a Go).
			params = append(params, bigquery.QueryParameter{Name: "fulfillmentType", Value: p.FulfillmentType})
		}

		var filterChannel string
		if p.Channel != "" {
			filterChannel = "AND UPPER(TRIM(channel)) = @channel"
			params = append(params, bigquery.QueryParameter{Name: "channel", Value: p.Channel})
		}

		var filterMarketPlace string
		if p.MarketPlace != "" {
			filterMarketPlace = "AND marketPlace = @marketPlace"
			v, err := strconv.ParseBool(p.MarketPlace)
			if err != nil {
				return "", nil, "", fmt.Errorf("invalid marketPlace: %q", p.MarketPlace)
			}
			params = append(params, bigquery.QueryParameter{Name: "marketPlace", Value: v})
		}

		query := fmt.Sprintf(`
			WITH base AS (
				SELECT *,
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
			SELECT * FROM base WHERE clasificacion IN ('Error', 'Plan B')
		`, filterProductType, filterFulfillment, filterMarketPlace, filterChannel)

		return query, params, "", nil

	case OrdersCSVTypeRecalc:
		enterpriseCode := "Liverpool"
		if p.Company == "SB" || p.Company == "SBB" {
			enterpriseCode = "Suburbia"
		}
		params = append(params, bigquery.QueryParameter{Name: "enterpriseCode", Value: enterpriseCode})

		query := `
			WITH base AS (
				SELECT *,
					CASE
						WHEN JSON_EXTRACT_SCALAR(rawPayload, '$.Order.OrderLines.OrderLine[0].Extn.ExtnPromiseEDD1') IS NOT NULL
						 AND JSON_EXTRACT_SCALAR(rawPayload, '$.Order.OrderLines.OrderLine[0].Extn.ExtnPromiseEDD2') IS NOT NULL THEN 'Plan A'
						ELSE 'Error'
					END AS clasificacion
				FROM ` + "`crp-pro-dig-edd.mus_pro_digital_prd_tbls.FAC_EDD_RECALCULATE_TRN`" + `
				WHERE messageType = 'ORDER_CREATED'
					AND JSON_EXTRACT_SCALAR(rawPayload, '$.Order.EnterpriseCode') = @enterpriseCode
					AND _ingested_at >= TIMESTAMP(@start, 'America/Mexico_City')
					AND _ingested_at <  TIMESTAMP(@end,   'America/Mexico_City')
			)
			SELECT * FROM base WHERE clasificacion IN ('Error', 'Plan B')
		`

		return query, params, "", nil

	default:
		return "", nil, "", fmt.Errorf("tipo inválido (summary, decomm, recalc)")
	}
}

// stringifyBQRow convierte una fila cruda de BigQuery ([]bigquery.Value,
// tipos dinámicos porque la consulta usa SELECT *) a texto, análogo al
// helper `csvValue` de server.js (NULL -> celda vacía, objetos con
// value/fecha -> su representación en texto).
func stringifyBQRow(row []bigquery.Value) []string {
	out := make([]string, len(row))
	for i, v := range row {
		out[i] = stringifyBQValue(v)
	}
	return out
}

func stringifyBQValue(v bigquery.Value) string {
	switch val := v.(type) {
	case nil:
		return ""
	case string:
		return val
	case bool:
		return strconv.FormatBool(val)
	case int64:
		return strconv.FormatInt(val, 10)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case []byte:
		return string(val)
	case *big.Rat:
		return val.FloatString(9)
	case civil.Date:
		return val.String()
	case civil.Time:
		return val.String()
	case civil.DateTime:
		return val.String()
	case time.Time:
		return val.UTC().Format("2006-01-02T15:04:05.000Z")
	case []bigquery.Value:
		parts := make([]string, len(val))
		for i, e := range val {
			parts[i] = stringifyBQValue(e)
		}
		return joinSemicolon(parts)
	default:
		return fmt.Sprintf("%v", val)
	}
}

func joinSemicolon(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += "; "
		}
		out += p
	}
	return out
}
