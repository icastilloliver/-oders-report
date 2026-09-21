# Reporte Pedidos LP — BigQuery + React + Vite

Dashboard ejecutivo que consulta BigQuery (compañía LP, Soft Line) y muestra la distribución diaria de pedidos por plan (A, B, Error) con KPIs sumarizados y una gráfica de barras 100% apilada.

## Arquitectura

```
reporte-pedidos-lp/
├── backend/         Go + cloud.google.com/go/bigquery
│                    Mantiene la Service Account, expone /api/* y sirve el
│                    build del frontend (internal/transport/static.go) —
│                    un solo binario, un solo proceso en producción.
└── frontend/        Vite + React + Chart.js
                     Consume /api/* y renderiza KPIs + gráficas
```

> ⚠️ **Seguridad**: la Service Account vive ÚNICAMENTE en el backend. Nunca se incluye ni se expone en el frontend (sería visible para cualquier visitante).

## Setup rápido

### 1. Service Account de Google

1. Crea una SA en GCP Console → IAM & Admin → Service Accounts.
2. Asígnale los roles `BigQuery Data Viewer` y `BigQuery Job User` sobre el proyecto correspondiente.
3. Descarga la llave JSON y guárdala como `backend/service-account.json` (ya está en `.gitignore`), o usa Application Default Credentials (`gcloud auth application-default login`) — no hace falta el archivo si ya tienes ADC configurado.

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edita .env si necesitas cambiar el projectId o la ubicación del dataset
go run ./cmd/api
```

El backend queda corriendo en `http://localhost:8080`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

El dashboard queda en `http://localhost:5173`. Vite hace proxy de `/api/*` → `http://localhost:8080`.

### Todo junto

Desde la raíz del repo, `npm run dev:full` levanta ambos (`dev:backend` + `dev:frontend`) en paralelo con `concurrently`. `npm run deploy` construye y despliega la imagen de `Dockerfile` a Cloud Run vía `gcloud run deploy --source .` (un solo contenedor: el binario Go sirve tanto la API como el frontend compilado).

### Catálogo de errorCode

`frontend/src/errorCatalog.js` es la fuente única de verdad: etiqueta, descripción,
categoría y color de cada código. El color está fijado **por código**, no por
frecuencia, para que el mismo error se vea igual entre rangos de fecha y entre
vistas.

| Código | Etiqueta | Categoría | Significado |
|---|---|---|---|
| 0 | Sin error | Sin error | EDD calculada correctamente |
| 2 | Nodos en hold | Operación | El o los nodos están en hold (`edd_nodo_item_hold`) |
| 3 | Sin trazos para el CP | Cobertura | No hay trazos logísticos para ese código postal |
| 4 | Inventario insuficiente | Inventario | El inventario de la red no cubre la cantidad |
| 5 | Sin capacidad operativa | Capacidad | Sin capacidad operativa OMS |
| 6 | Sin capacidad 4PL | Capacidad | Sin capacidad del par (nodo, carrier) |
| 7 | Falla del solver | Motor | Falla real del solver (CBC). Genérico y ya poco frecuente: cuando la demanda no cabe en las cotas se reporta 4/5/6 con la causa real |
| 8 | Error inesperado de fecha | Motor | El motor no devolvió rutas, o devolvió una fecha vacía o malformada |
| 99 | Error del motor | Motor | Error del motor para ese CP (mensaje dinámico), o el motor no devolvió resultado para el SKU |

`normalizeCode` colapsa las variantes del dato (`'04'`, `4`, `' 4 '` → `'4'`).
Los códigos que no estén en la tabla reciben etiqueta genérica y un color
determinista derivado del propio código; los registros sin código caen en
**Sin código**.

### Desglose por errorCode

`GET /api/error-codes?start=YYYY-MM-DD&end=YYYY-MM-DD&company=SB&fulfillmentType=…`

Agrupa por `errorCode` los registros de `FAC_EDD_ORDERS_TRN` que caen en la
clasificación **Error**, usando el mismo `CASE` que `/api/orders-decomm` para que
el total cuadre exactamente con el KPI y la barra de % Error. Los `errorCode`
vacíos o nulos se agrupan como `SIN CÓDIGO`.

Devuelve `{ data: [{ errorCode, errorMessage, total }, ...], total }`.

Lo consume la gráfica de dona de la pestaña **SBB Decomm** (vista Planes A/B),
que se refresca con el rango de fechas y el filtro de tipo de surtido. Muestra
los 8 códigos más frecuentes y agrupa el resto en «Otros».

### Tendencia diaria de errores (tabs Decomm)

`GET /api/error-trend?start&end&company&fulfillmentType&marketPlace` — serie por
día de líneas Error por `errorCode` + total de líneas/errores del día. Acepta
los mismos filtros que `/api/error-codes` para cuadrar con la dona. La tarjeta
**Comportamiento diario de los errores** (tabs SBB y LP Decomm) la grafica como
líneas por causal (top 5 + «Otros» punteado, colores del catálogo) con dos
modos — registros por día y % de las líneas del día (la suma de series = %
Error diario) — tooltip de columna completa, nota del día pico y tabla gemela.

### Métricas de error en LP Decomm

El tab **LP Decomm** (vista Planes A/B) muestra, además de los KPIs y la
gráfica diaria:

- **Composición del % Error por errorCode** — la misma dona de SBB Decomm
  (`/api/error-codes`), ahora también para LP y respetando el filtro de tipo
  de producto (`marketPlace`), con descarga CSV por rebanada.
- **Error por tipo de surtido** — `GET /api/error-codes-fulfillment?start&end&company=LP&marketPlace=`
  compara Entrega a domicilio (`Fulfillment_Type_Liverpool`) vs Click & Collect
  (`Liverpool_CNC_PICK_PACK`): tasa de error de cada segmento (errores / líneas
  totales del segmento) y tabla de causales lado a lado con el % dentro del
  Error de cada surtido, barras por código (colores del catálogo) y descarga
  CSV por causal + segmento. Las líneas con otro fulfillmentType se reportan
  en una nota y sí cuentan en la dona. Esta comparativa ignora el filtro de
  surtido (compara ambos), pero respeta el de producto.
- Los totales cuadran entre sí: dona = domicilio + C&C + otros, con el mismo
  `CASE` de clasificación que `/api/orders-decomm`.

### Cotejo masivo de órdenes

`POST /api/orders-bulk-check`

```json
{ "orderNumbers": ["6310116494", "6310116495"] }
```

- Máximo **500 órdenes por petición** (el frontend divide la lista en lotes de 400).
- Acepta identificadores alfanuméricos de 6 a 64 caracteres: remisiones Suburbia
  (`sg2608090011688`), folios `KS0000438222`, UUIDs y órdenes numéricas.
- Para los IDs con prefijo de letras + dígitos busca **ambas variantes**
  (`sg2608090011688` y `2608090011688`) y reporta en `matchedWithoutPrefix`
  cuántas coincidieron solo sin prefijo. Los UUIDs no generan variante.
- Consulta `FAC_EDD_ORDERS_TRN` sobre los últimos **180 días**, todas las compañías.

Devuelve:

```json
{
  "orders": [{ "orderNumber", "found", "hasError", "lines", "linesWithError",
               "errorCodes": [], "plans": [], "company", "channel", "createdAt",
               "detail": [] }],
  "summary": { "requested", "invalid", "found", "notFound", "ordersWithError",
               "totalLines", "linesWithError", "errorCodeCounts": {} }
}
```

La vista **Cotejar Lista** del dashboard consume este endpoint: sube un CSV/Excel,
confirma las columnas de **remisión** y **SKU** (ambas se autodetectan) y obtiene
KPIs con porcentajes —con `errorCode`, sin error, sin coincidencia (orden no
encontrada vs. SKU no encontrado en la orden)—, el desglose por `errorCode` y la
exportación a CSV, que conserva las columnas originales del archivo y agrega las
columnas `_estatus`, `_errorCode`, `_errorMessage`, `_plan`, `_edd1`, `_edd2`,
`_origen`, `_company` y `_matchedAs`.

El cotejo por par remisión + SKU compara los SKU ignorando ceros a la izquierda.
Si se deja la columna de SKU en «Cotejar solo por orden», el veredicto es por orden.

### Validación ATP (SBB Decomm → OMS Suburbia)

La pestaña **Validación ATP** automatiza el flujo que antes se hacía a mano
(exportar el CSV de decomm y correr un script): trae directo del query las
filas clasificadas como **Error** y las valida contra el OMS de Suburbia.

- `GET /api/atp-decomm-rows?start&end&company=SB|LP` — filas Error de
  `FAC_EDD_ORDERS_TRN` (mismo `CASE` que `/api/orders-decomm`), máximo 3,000
  por rango (`truncated: true` si se cortó).
- `POST /api/atp-validate` — `{ company: 'SB', items: [{ sku, quantity, zipCode }] }`
  (máx. 20 por petición; el frontend manda lotes de 10). Por cada combinación
  única SKU + cantidad + CP llama a `EPLInventoryAvailabilityWebService`
  (envoltorio del API core `promise` de Sterling) con **timeout configurable
  desde la UI** (`timeoutSeconds` en el body; 5-60 s, default 20 — el backend
  acota el rango y el valor se recuerda en el navegador) y clasifica la
  respuesta:

  | Estatus | Significado |
  |---|---|
  | `CORRECTO` | La respuesta trae `<SuggestedOption><Option>` con nodo y fecha promesa |
  | `NOT_ENOUGH_PRODUCT_CHOICES` | `UnavailableLine`: el motor agotó los nodos sin inventario/capacidad (estas respuestas tardan 15-20 s) |
  | `TIMEOUT` | Sin respuesta en 20 s (suelen ser NEPC lentos: conviene revalidar) |
  | `OTRO_ERROR` | Cualquier otra respuesta (se reporta `ErrorCode`/mensaje) |

  El prefijo `SB` del SKU se quita antes de consultar OMS (`SB5014548396` →
  `5014548396`). La llamada va sin cookies y con User-Agent tipo curl: las
  cookies de Akamai y el UA por defecto de Node hacen que el WAF cuelgue la
  conexión.

- **Solo aplica a SBB Decomm**: el servicio no existe para Liverpool, así que
  con `company=LP` el endpoint de validación responde 400 y la vista solo
  muestra/exporta el detalle de errores del query.
- La exportación CSV conserva las columnas del query y agrega `_atpEstatus`,
  `_atpErrorCode`, `_atpMensaje`, `_atpNodo`, `_atpFechaEntrega` y `_atpSegundos`.
- **Config requerida** en `backend/.env`: `OMS_ATP_AUTH` (credencial Basic del
  OMS; sin ella `/api/atp-validate` responde 503). `OMS_ATP_URL` es opcional.
  La credencial NO vive en el código ni en `.env.example`.
- **Solo funciona desde la red corporativa/VPN**: `oms.suburbia.com.mx` no
  resuelve en DNS público (la vista lo reporta como `DNS_NO_ROUTE`). Para
  Cloud Run haría falta un VPC connector + zona DNS privada hacia la red de
  Liverpool; hoy la validación está pensada para correr local.
- Un SKU/CP inválido en el lote (p. ej. `SB991`) no detiene la corrida: se
  reporta individualmente como `DATOS_INVALIDOS` y el resto se valida normal.
