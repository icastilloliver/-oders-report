import { useState, useRef, useMemo, useEffect } from 'react';
import {
  Calendar,
  RefreshCcw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Download,
  ListChecks,
  Loader2,
  Info,
  PackageSearch,
  Radar,
  Home,
  Store,
  Truck,
  Timer,
} from 'lucide-react';
import AtpLatencyChart from './AtpLatencyChart.jsx';
import DateRange from './DateRange.jsx';

/* ─────────────────── constantes ───────────────────
 * La validación consulta EPLInventoryAvailabilityWebService en el OMS de
 * Suburbia (envoltorio del API core `promise`). Ese servicio SOLO existe
 * para SBB: en LP Decomm la vista carga y exporta el detalle del query,
 * pero no puede validar disponibilidad. */

const BATCH_SIZE = 10; // items por POST /api/atp-validate (máx. 20 en backend)
const TIMEOUT_DEFAULT_S = 20;
const TIMEOUT_MIN_S = 5; // mismo rango que acota el backend
const TIMEOUT_MAX_S = 60;

const clampTimeout = (v) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return TIMEOUT_DEFAULT_S;
  return Math.min(TIMEOUT_MAX_S, Math.max(TIMEOUT_MIN_S, n));
};

const ATP_STATUS = {
  CORRECTO: {
    label: 'Correcto',
    badge: 'badge--plan',
    icon: CheckCircle2,
    desc: 'OMS regresó opción de entrega (SuggestedOption)',
  },
  NOT_ENOUGH_PRODUCT_CHOICES: {
    label: 'NEPC',
    badge: 'badge--noedd',
    icon: AlertTriangle,
    desc: 'Sin opciones de producto: el motor agotó los nodos sin inventario/capacidad',
  },
  TIMEOUT: {
    label: 'Timeout',
    badge: 'badge--planb',
    icon: Clock,
    desc: 'El servicio no respondió dentro del timeout configurado',
  },
  OTRO_ERROR: {
    label: 'Otro error',
    badge: 'badge--standard',
    icon: XCircle,
    desc: 'Respuesta de error distinta a NOT_ENOUGH_PRODUCT_CHOICES',
  },
};

const FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'CORRECTO', label: 'Correcto' },
  { key: 'NOT_ENOUGH_PRODUCT_CHOICES', label: 'NEPC' },
  { key: 'TIMEOUT', label: 'Timeout' },
  { key: 'OTRO_ERROR', label: 'Otro error' },
  { key: 'pending', label: 'Sin validar' },
];

/* ─────────────────── helpers ─────────────────── */

// Fecha local (no toISOString/UTC): de madrugada el día UTC ya cambió y el
// rango por defecto se recorrería un día contra America/Mexico_City.
const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const pct = (part, total) => (total > 0 ? (part / total) * 100 : 0);
const fmtPct = (n) => `${n.toFixed(1).replace(/\.0$/, '')}%`;
const fmtNum = (n) => n.toLocaleString('es-MX');
const norm = (s) => String(s ?? '').trim().toLowerCase();

/** Una llamada a OMS por combinación única sku + cantidad + CP */
const comboKey = (r) => `${String(r.sku).trim()}|${String(r.quantity).trim()}|${String(r.zipCode).trim()}`;

function toCSV(rows, fields) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [fields.join(','), ...rows.map((r) => fields.map((f) => esc(r[f])).join(','))].join('\n');
}

function download(filename, text) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function StatCard({ tone = 'neutral', icon: Icon, label, value, sub, bar }) {
  return (
    <div className={`bulk-stat bulk-stat--${tone}`}>
      <div className="bulk-stat__head">
        <Icon size={15} strokeWidth={2.2} />
        <span>{label}</span>
      </div>
      <strong className="bulk-stat__value">{value}</strong>
      {sub && <span className="bulk-stat__sub">{sub}</span>}
      {typeof bar === 'number' && (
        <div className="bulk-stat__bar" role="presentation">
          <span style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </div>
      )}
    </div>
  );
}

/* ─────────────────── vista principal ─────────────────── */

function AtpDecomm() {
  const today = useMemo(() => new Date(), []);
  const [company, setCompany] = useState('SB'); // 'SB' (valida) | 'LP' (solo detalle)
  const [startDate, setStartDate] = useState(toISO(addDays(today, -2)));
  const [endDate, setEndDate] = useState(toISO(addDays(today, 1)));
  const [fulfillment, setFulfillment] = useState('all');
  // Timeout hacia OMS, configurable desde la UI y recordado entre sesiones.
  const [timeoutSecs, setTimeoutSecs] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem('atp-timeout'), 10);
      return saved >= TIMEOUT_MIN_S && saved <= TIMEOUT_MAX_S ? saved : TIMEOUT_DEFAULT_S;
    } catch {
      return TIMEOUT_DEFAULT_S;
    }
  });
  const [ranTimeout, setRanTimeout] = useState(null); // timeout usado en la corrida actual

  const [rows, setRows] = useState(null); // filas Error del query
  const [truncated, setTruncated] = useState(false);
  const [loadedWith, setLoadedWith] = useState(null); // { company, start, end }
  const [loadingRows, setLoadingRows] = useState(false);

  const [atpMap, setAtpMap] = useState(new Map()); // comboKey → resultado ATP
  const [validating, setValidating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const cancelRef = useRef(false);
  const runRef = useRef(0); // token de corrida: invalida lotes en vuelo al cancelar/revalidar
  useEffect(() => () => { cancelRef.current = true; runRef.current += 1; }, []);

  const isSB = company === 'SB';
  /* La sección de resultados se rige por la fuente CARGADA, no por el chip:
     así cambiar el chip sin recargar nunca valida filas LP contra OMS. */
  const sourceIsSB = loadedWith ? loadedWith.company === 'SB' : isSB;

  /* Cambiar de fuente descarta lo cargado: filas LP no deben validarse
     contra OMS ni conservar filtros/resultados de la otra fuente. */
  const changeCompany = (c) => {
    if (c === company) return;
    setCompany(c);
    setRows(null);
    setLoadedWith(null);
    setAtpMap(new Map());
    setProgress({ done: 0, total: 0 });
    setFilter('all');
    setSearch('');
    setError(null);
  };

  /* ── Paso 1: cargar filas Error desde el query de decomm ── */
  const loadRows = async () => {
    setError(null);
    setLoadingRows(true);
    setRows(null);
    setAtpMap(new Map());
    setProgress({ done: 0, total: 0 });
    setFilter('all');
    setSearch('');
    try {
      const params = new URLSearchParams({ start: startDate, end: endDate, company });
      if (fulfillment !== 'all') params.set('fulfillmentType', fulfillment);
      const res = await fetch(`/api/atp-decomm-rows?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.rows);
      setTruncated(Boolean(json.truncated));
      setLoadedWith({ company, start: startDate, end: endDate });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingRows(false);
    }
  };

  /* ── Combinaciones únicas a consultar en OMS ── */
  const combos = useMemo(() => {
    if (!rows) return [];
    const seen = new Map();
    for (const r of rows) {
      const key = comboKey(r);
      if (!seen.has(key)) {
        seen.set(key, { key, sku: r.sku, quantity: r.quantity, zipCode: r.zipCode });
      }
    }
    return [...seen.values()];
  }, [rows]);

  /* ── Paso 2: validar ATP por lotes (solo SBB) ── */
  const validate = async () => {
    if (!sourceIsSB || combos.length === 0 || validating) return;
    cancelRef.current = false;
    const runId = ++runRef.current;
    // El timeout se congela por corrida: cambiarlo a media validación no debe
    // mezclar criterios entre lotes ni desfasar la gráfica.
    const runTimeout = clampTimeout(timeoutSecs);
    setTimeoutSecs(runTimeout);
    setRanTimeout(runTimeout);
    try { localStorage.setItem('atp-timeout', String(runTimeout)); } catch { /* sin storage */ }
    setError(null);
    setValidating(true);
    setAtpMap(new Map());
    setProgress({ done: 0, total: combos.length });

    const map = new Map();
    for (let i = 0; i < combos.length; i += BATCH_SIZE) {
      if (cancelRef.current || runRef.current !== runId) return;
      const batch = combos.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch('/api/atp-validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company: 'SB',
            timeoutSeconds: runTimeout,
            items: batch.map(({ sku, quantity, zipCode }) => ({ sku, quantity, zipCode })),
          }),
        });
        const json = await res.json();
        // Una corrida vieja (cancelada o reemplazada) no debe pisar el estado.
        if (runRef.current !== runId) return;
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        // El backend conserva el orden del lote: mapeamos por posición.
        json.results.forEach((result, j) => map.set(batch[j].key, result));
        setAtpMap(new Map(map));
        setProgress({ done: Math.min(i + BATCH_SIZE, combos.length), total: combos.length });
      } catch (e) {
        if (runRef.current !== runId) return;
        setError(`Se detuvo en el lote ${Math.floor(i / BATCH_SIZE) + 1}: ${e.message}`);
        break;
      }
    }
    if (runRef.current === runId) setValidating(false);
  };

  const cancelValidate = () => {
    cancelRef.current = true;
    runRef.current += 1; // el lote en vuelo ya no escribe estado
    setValidating(false);
  };

  /* ── Filas enriquecidas con su resultado ATP ── */
  const enriched = useMemo(() => {
    if (!rows) return [];
    return rows.map((r) => ({ ...r, atp: atpMap.get(comboKey(r)) || null }));
  }, [rows, atpMap]);

  const stats = useMemo(() => {
    const by = (s) => enriched.filter((r) => r.atp?.status === s).length;
    return {
      total: enriched.length,
      combos: combos.length,
      correcto: by('CORRECTO'),
      nepc: by('NOT_ENOUGH_PRODUCT_CHOICES'),
      timeout: by('TIMEOUT'),
      otro: by('OTRO_ERROR'),
      pending: enriched.filter((r) => !r.atp).length,
    };
  }, [enriched, combos]);

  /* Llamadas únicas realmente hechas a OMS (sin los items DATOS_INVALIDOS,
     que no se consultaron y ensuciarían la gráfica de latencias en x=0). */
  const uniqueCalls = useMemo(
    () => [...atpMap.values()].filter((c) => c.errorCode !== 'DATOS_INVALIDOS'),
    [atpMap]
  );

  const skuRepeats = useMemo(() => {
    const counts = {};
    for (const r of enriched) {
      if (r.atp?.status !== 'NOT_ENOUGH_PRODUCT_CHOICES') continue;
      counts[r.sku] = (counts[r.sku] || 0) + 1;
    }
    return Object.entries(counts)
      .filter(([, c]) => c > 1)
      .sort((a, b) => b[1] - a[1]);
  }, [enriched]);

  const visible = useMemo(() => {
    let list = enriched;
    if (filter === 'pending') list = list.filter((r) => !r.atp);
    else if (filter !== 'all') list = list.filter((r) => r.atp?.status === filter);
    const q = norm(search);
    if (q) {
      list = list.filter(
        (r) =>
          norm(r.sku).includes(q) || norm(r.orderNumber).includes(q) || norm(r.zipCode).includes(q)
      );
    }
    return list;
  }, [enriched, filter, search]);

  /* ── Exportación: columnas del query + resultado ATP ── */
  const exportRows = () => {
    if (visible.length === 0) return;
    const out = visible.map((r) => {
      const { atp, ...orig } = r;
      return {
        ...orig,
        _atpEstatus: atp ? atp.status : 'SIN_VALIDAR',
        _atpErrorCode: atp?.errorCode || '',
        _atpMensaje: atp?.errorMessage || '',
        _atpNodo: atp?.shipNode || '',
        _atpFechaEntrega: atp?.deliveryDate || '',
        _atpSegundos: atp?.seconds ?? '',
      };
    });
    const range = loadedWith ? `${loadedWith.start}_${loadedWith.end}` : 'rango';
    download(`atp_${loadedWith?.company || company}_decomm_${range}.csv`, toCSV(out, Object.keys(out[0])));
  };

  const progressPct = progress.total ? (progress.done / progress.total) * 100 : 0;
  const validated = stats.total - stats.pending;
  const hasResults = atpMap.size > 0;
  /* Para etiquetas y gráfica: el timeout de la corrida ya hecha; si aún no
     hay corrida, el configurado actualmente. */
  const effTimeout = ranTimeout ?? clampTimeout(timeoutSecs);

  /* ─────────────────── render ─────────────────── */

  return (
    <div className="bulk-check">
      {/* ── Fuente y rango ── */}
      <div className="filters-card">
        <div className="quick-ranges" role="group" aria-label="Fuente decomm">
          <span className="quick-ranges__label">
            <Radar size={12} /> Fuente
          </span>
          <button
            type="button"
            className={`chip ${isSB ? 'active' : ''}`}
            onClick={() => changeCompany('SB')}
            disabled={validating}
          >
            SBB Decomm
          </button>
          <button
            type="button"
            className={`chip ${!isSB ? 'active' : ''}`}
            onClick={() => changeCompany('LP')}
            disabled={validating}
          >
            LP Decomm
          </button>
          {!isSB && (
            <span className="quick-ranges__note">
              Solo detalle: el servicio ATP de OMS existe únicamente para Suburbia
            </span>
          )}
        </div>

        <div className="quick-ranges" role="group" aria-label="Tipo de surtido">
          <span className="quick-ranges__label">
            <Truck size={12} /> Surtido
          </span>
          <button
            type="button"
            className={`chip ${fulfillment === 'all' ? 'active' : ''}`}
            onClick={() => setFulfillment('all')}
            disabled={validating}
          >
            Todos
          </button>
          <button
            type="button"
            className={`chip ${fulfillment === 'Fulfillment_Type_Liverpool' ? 'active' : ''}`}
            onClick={() => setFulfillment('Fulfillment_Type_Liverpool')}
            disabled={validating}
            title="Fulfillment_Type_Liverpool"
          >
            <Home size={12} />
            Entrega a domicilio
          </button>
          <button
            type="button"
            className={`chip ${fulfillment === 'Liverpool_CNC_PICK_PACK' ? 'active' : ''}`}
            onClick={() => setFulfillment('Liverpool_CNC_PICK_PACK')}
            disabled={validating}
            title="Liverpool_CNC_PICK_PACK"
          >
            <Store size={12} />
            Click & Collect (tienda)
          </button>
        </div>

        <div className="filters">
          <DateRange
            startId="atp-start"
            endId="atp-end"
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
          />

          <div className="field" style={{ maxWidth: '160px' }}>
            <label htmlFor="atp-timeout" title={`Entre ${TIMEOUT_MIN_S} y ${TIMEOUT_MAX_S} segundos`}>
              Timeout OMS (s)
            </label>
            <div className="input-wrap">
              <Timer className="input-wrap__icon" size={16} />
              <input
                id="atp-timeout"
                type="number"
                min={TIMEOUT_MIN_S}
                max={TIMEOUT_MAX_S}
                step={5}
                value={timeoutSecs}
                onChange={(e) => setTimeoutSecs(e.target.value)}
                onBlur={() => setTimeoutSecs(clampTimeout(timeoutSecs))}
                disabled={validating}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <button className="btn-primary" onClick={loadRows} disabled={loadingRows || validating}>
              {loadingRows ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Consultando…
                </>
              ) : (
                <>
                  <RefreshCcw size={15} strokeWidth={2.4} />
                  Cargar del query
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          <AlertTriangle className="alert__icon" size={18} />
          <div>
            <strong>Algo salió mal.</strong> {error}
          </div>
        </div>
      )}

      {/* ── Sin cargar todavía ── */}
      {!rows && !loadingRows && !error && (
        <div className="alert alert--info">
          <Info className="alert__icon" size={18} />
          <div>
            <strong>Elige fuente y rango, y pulsa «Cargar del query».</strong> Se traen las filas
            clasificadas como <strong>Error</strong> de <code>FAC_EDD_ORDERS_TRN</code> — la misma
            fuente del reporte de decomm, sin pasar por Excel. Con SBB Decomm puedes validar cada
            SKU/cantidad/CP contra OMS (<code>EPLInventoryAvailabilityWebService</code>) con el
            timeout que configures ({TIMEOUT_MIN_S}-{TIMEOUT_MAX_S} s).
          </div>
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="alert alert--info">
          <Info className="alert__icon" size={18} />
          <div>
            <strong>Sin errores en el rango.</strong> El query no regresó filas clasificadas como
            Error para {loadedWith?.company === 'SB' ? 'SBB' : 'LP'} Decomm entre {loadedWith?.start}{' '}
            y {loadedWith?.end}. Amplía las fechas o cambia de fuente.
          </div>
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          {truncated && (
            <div className="alert alert--info">
              <Info className="alert__icon" size={18} />
              <div>
                <strong>Resultado truncado.</strong> Se muestran las primeras{' '}
                {fmtNum(rows.length)} filas del rango. Acorta las fechas para el universo completo.
              </div>
            </div>
          )}

          {/* ── Resumen + acción ── */}
          <header className="bulk-results__head">
            <div>
              <h2>
                Errores {loadedWith?.company === 'SB' ? 'SBB' : 'LP'} Decomm ·{' '}
                {loadedWith?.start} → {loadedWith?.end}
              </h2>
              <p>
                {fmtNum(stats.total)} filas con Error · {fmtNum(stats.combos)} combinaciones únicas
                SKU + cantidad + CP
                {hasResults &&
                  ` · ${fmtNum(validated)} filas validadas contra OMS`}
              </p>
            </div>
            <div className="bulk-results__actions">
              {sourceIsSB && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={validate}
                  disabled={validating || combos.length === 0}
                >
                  {validating ? (
                    <>
                      <span className="spinner" aria-hidden="true" />
                      Validando…
                    </>
                  ) : (
                    <>
                      <Radar size={15} strokeWidth={2.4} />
                      {hasResults ? 'Revalidar ATP' : `Validar ATP (${fmtNum(combos.length)} llamadas)`}
                    </>
                  )}
                </button>
              )}
              <button type="button" className="chip" onClick={exportRows} disabled={visible.length === 0}>
                <Download size={12} /> Exportar CSV
              </button>
            </div>
          </header>

          {!sourceIsSB && (
            <div className="alert alert--info">
              <Info className="alert__icon" size={18} />
              <div>
                <strong>LP Decomm no se valida contra OMS.</strong> El servicio{' '}
                <code>EPLInventoryAvailabilityWebService</code> (oms.suburbia.com.mx) solo existe
                para Suburbia. Aquí puedes revisar y exportar el detalle de errores del query.
              </div>
            </div>
          )}

          {/* ── Progreso ── */}
          {validating && (
            <section className="bulk-panel bulk-panel--running">
              <Loader2 className="bulk-spin" size={30} strokeWidth={2} />
              <h3>Consultando OMS Suburbia…</h3>
              <div className="bulk-progress">
                <span style={{ width: `${progressPct}%` }} />
              </div>
              <p>
                {fmtNum(progress.done)} de {fmtNum(progress.total)} llamadas ·{' '}
                {Math.round(progressPct)}% — las respuestas NEPC tardan 15-20 s cada una
              </p>
              <button type="button" className="chip" onClick={cancelValidate}>
                Cancelar
              </button>
            </section>
          )}

          {/* ── KPIs ── */}
          {hasResults && (
            <div className="bulk-stats">
              <StatCard
                tone="neutral"
                icon={ListChecks}
                label="Filas Error del rango"
                value={fmtNum(stats.total)}
                sub={`${fmtNum(stats.combos)} llamadas únicas a OMS`}
              />
              <StatCard
                tone="success"
                icon={CheckCircle2}
                label="Correcto (con promesa)"
                value={fmtNum(stats.correcto)}
                sub={`${fmtPct(pct(stats.correcto, validated))} de lo validado`}
                bar={pct(stats.correcto, validated)}
              />
              <StatCard
                tone="danger"
                icon={AlertTriangle}
                label="NOT_ENOUGH_PRODUCT_CHOICES"
                value={fmtNum(stats.nepc)}
                sub={`${fmtPct(pct(stats.nepc, validated))} de lo validado · error a rastrear`}
                bar={pct(stats.nepc, validated)}
              />
              <StatCard
                tone="warning"
                icon={Clock}
                label={`Timeout > ${effTimeout} s`}
                value={fmtNum(stats.timeout)}
                sub="suelen ser NEPC lentos: reintenta"
                bar={pct(stats.timeout, validated)}
              />
              <StatCard
                tone="warning"
                icon={XCircle}
                label="Otros errores"
                value={fmtNum(stats.otro)}
                sub={stats.pending > 0 ? `${fmtNum(stats.pending)} filas sin validar` : 'todo validado'}
                bar={pct(stats.otro, validated)}
              />
            </div>
          )}

          {/* ── Gráfica: tiempo de respuesta por llamada ── */}
          {uniqueCalls.length > 0 && (
            <div className="chart-card">
              <div className="chart-card__head">
                <div>
                  <h2>
                    <Timer size={18} strokeWidth={2.2} />
                    Tiempo de respuesta por llamada
                  </h2>
                  <p className="subtitle">
                    {fmtNum(uniqueCalls.length)} llamadas únicas al servicio · cada punto es una
                    llamada — pasa el cursor o usa Tab para ver el detalle. Las respuestas NEPC
                    tardan 15-20 s: la latencia alta predice el error.
                  </p>
                </div>
              </div>
              <AtpLatencyChart calls={uniqueCalls} timeoutSeconds={effTimeout} />
            </div>
          )}

          {skuRepeats.length > 0 && (
            <div className="alert alert--info">
              <Info className="alert__icon" size={18} />
              <div>
                <strong>SKUs que repiten NEPC:</strong>{' '}
                {skuRepeats.map(([sku, c]) => `${sku} (${c}×)`).join(', ')}
              </div>
            </div>
          )}

          {/* ── Tabla ── */}
          <section className="bulk-table">
            <header className="bulk-table__head">
              <div className="bulk-table__filters" role="tablist">
                {FILTERS.filter((f) => sourceIsSB || f.key === 'all').map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.key}
                    className={`chip ${filter === f.key ? 'active' : ''}`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="bulk-table__search">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="Filtrar por SKU, remisión o CP"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </header>

            <div className="bulk-table__scroll">
              <table>
                <thead>
                  <tr>
                    <th>Remisión</th>
                    <th>SKU</th>
                    <th>Cant.</th>
                    <th>CP</th>
                    <th>Ciudad destino</th>
                    <th>errorCode EDD</th>
                    {sourceIsSB && (
                      <>
                        <th>ATP OMS</th>
                        <th>Nodo</th>
                        <th>Fecha promesa</th>
                        <th>Seg.</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, 500).map((r, i) => {
                    const meta = r.atp ? ATP_STATUS[r.atp.status] : null;
                    const MetaIcon = meta?.icon;
                    return (
                      <tr key={`${r.recordId || r.orderNumber}-${r.sku}-${i}`}>
                        <td><code>{r.orderNumber}</code></td>
                        <td><code>{r.sku}</code></td>
                        <td>{r.quantity}</td>
                        <td><code>{r.zipCode}</code></td>
                        <td>{r.destinationCity || '—'}</td>
                        <td>{r.errorCode || '—'}</td>
                        {sourceIsSB && (
                          <>
                            <td>
                              {meta ? (
                                <span className={`badge ${meta.badge}`} title={r.atp.errorMessage || meta.desc}>
                                  <MetaIcon size={11} strokeWidth={2.4} />
                                  {meta.label}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>{r.atp?.shipNode || '—'}</td>
                            <td>{r.atp?.deliveryDate ? r.atp.deliveryDate.slice(0, 10) : '—'}</td>
                            <td>{r.atp?.seconds ?? '—'}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {visible.length === 0 && (
                <div className="search-empty">
                  <PackageSearch size={34} strokeWidth={1.6} />
                  <h3>Sin filas con este filtro</h3>
                  <p>Cambia el filtro o limpia la búsqueda.</p>
                </div>
              )}
            </div>

            {visible.length > 500 && (
              <p className="bulk-hint">
                Mostrando las primeras 500 de {fmtNum(visible.length)}. Exporta el CSV para ver todo.
              </p>
            )}
          </section>

          <p className="bulk-hint">
            Criterios: <strong>Correcto</strong> = la respuesta trae{' '}
            <code>&lt;SuggestedOption&gt;&lt;Option&gt;</code> con promesa de entrega ·{' '}
            <strong>NEPC</strong> = <code>UnavailableLine</code> con{' '}
            <code>NOT_ENOUGH_PRODUCT_CHOICES</code> · <strong>Timeout</strong> = sin respuesta en{' '}
            {effTimeout} s (configurable arriba). El prefijo <code>SB</code> del SKU se quita antes
            de consultar OMS.
          </p>
        </>
      )}
    </div>
  );
}

export default AtpDecomm;
