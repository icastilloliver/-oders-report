import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CalendarDays,
  RefreshCcw,
  AlertCircle,
  Info,
  Inbox,
  Clock,
  BarChart3,
  PieChart,
  Download,
  Zap,
  Layers,
  Store,
  PackageSearch,
  FileSpreadsheet,
  Home,
  Truck,
  Eye,
  EyeOff,
  ShoppingBag,
  Radar,
  TrendingUp,
} from 'lucide-react';
import Sidebar from './components/Sidebar.jsx';
import KpiCards from './components/KpiCards.jsx';
import BarChart from './components/BarChart.jsx';
import DeliveryKpis from './components/DeliveryKpis.jsx';
import DeliveryChart from './components/DeliveryChart.jsx';
import StoreRanking from './components/StoreRanking.jsx';
import OrderSearch from './components/OrderSearch.jsx';
import BulkOrderCheck from './components/BulkOrderCheck.jsx';
import AtpDecomm from './components/AtpDecomm.jsx';
import ErrorCodePie from './components/ErrorCodePie.jsx';
import ErrorFulfillmentSplit from './components/ErrorFulfillmentSplit.jsx';
import ErrorTrendChart from './components/ErrorTrendChart.jsx';
import { KpiSkeleton, ChartSkeleton } from './components/Skeleton.jsx';
import CalendarWidget from './components/CalendarWidget.jsx';
import liverpoolLogo from './assets/liverpool-logo.svg';

/* ───────────────────────── helpers ───────────────────────── */
/* Fecha local en YYYY-MM-DD. A propósito NO usa toISOString(): ese convierte a
   UTC y en México (UTC-6) devolvería el día siguiente a partir de las 18:00. */
const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Parsea 'YYYY-MM-DD' como medianoche local (new Date(str) lo haría en UTC) */
const fromISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/* El backend interpreta las fechas en America/Mexico_City (repository/orders.go),
   así que "hoy" se fija a esa zona y no a la del navegador. */
const TZ = 'America/Mexico_City';
const tzFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** 'YYYY-MM-DD' del día actual en México */
const todayISO = () => {
  const p = Object.fromEntries(
    tzFmt.formatToParts(new Date()).map(({ type, value }) => [type, value])
  );
  return `${p.year}-${p.month}-${p.day}`;
};

/** El día actual en México como Date a medianoche local, para aritmética */
const today = () => fromISO(todayISO());

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const startOfMonth = (date) => {
  const d = new Date(date);
  d.setDate(1);
  return d;
};

/** Calcula el rango anterior con la misma longitud para comparar tendencias */
const previousRange = (startISO, endISO) => {
  const s = fromISO(startISO);
  const e = fromISO(endISO);
  const days = Math.max(1, Math.round((e - s) / 86400000) + 1);
  const prevEnd = addDays(s, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return { start: toISO(prevStart), end: toISO(prevEnd) };
};

/** El backend filtra con `ingestionTimestamp < @end`, así que `end` es exclusivo:
    para incluir el último día visible hay que enviar el día siguiente. */
const toApiEnd = (endISO) => toISO(addDays(fromISO(endISO), 1));

/** Efecto ripple de Material (igual al de Conecta): círculo animado que
    nace en el punto exacto del click y se desvanece. El botón que lo usa
    necesita `position: relative; overflow: hidden;` (ver .ripple en CSS). */
const addRipple = (e) => {
  const button = e.currentTarget;
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
  button.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
};

/* ───────────────────────── config ────────────────────────── */
const QUICK_RANGES = [
  { key: 'today', label: 'Hoy', days: 0 },
  { key: '7d', label: 'Últimos 7 días', days: 6 },
  { key: '30d', label: 'Últimos 30 días', days: 29 },
  { key: 'mtd', label: 'Este mes', days: null },
];

const MULTISITE_DECOMM = ['WS', 'DCK', 'GAP', 'PB', 'PBK', 'BRU', 'BR', 'DPS', 'FAB', 'LVS', 'WLM'];

/** Nombre comercial de cada boutique (código interno usado en `company` sigue siendo {SITE}_DECOMM) */
const BOUTIQUE_LABELS = {
  WS: 'Willian Sonoma',
  DCK: 'Dockers',
  GAP: 'GAP',
  PB: 'Pottery Barn',
  PBK: 'Pottery Barn Kids',
  BRU: "Babys R'us",
  BR: 'Banana Republic',
  DPS: 'Dupuis',
  FAB: 'Fabletics',
  LVS: 'Livestore',
  WLM: 'West Elm',
};

/** Config del sidebar: sustituye al selector de vista + tabs de compañía */
const SIDEBAR_ITEMS = [
  {
    key: 'planes',
    label: 'Historial de Remisiones',
    icon: Layers,
    submenu: [
      { key: 'LP_DECOMM', label: 'Liverpool' },
      { key: 'SBB_DECOMM', label: 'Suburbia' },
      { key: 'LP_RECALC', label: 'Recalculadas' },
      {
        key: 'boutiques',
        label: 'Boutiques',
        // No es una sola compañía: agrupa los sitios de MULTISITE_DECOMM,
        // que ahora se eligen con el filtro "Boutique" dentro del dashboard.
        matchKeys: MULTISITE_DECOMM.map((site) => `${site}_DECOMM`),
      },
    ],
  },
  { key: 'entregas', label: 'Tipos de Entrega', icon: Zap },
  { key: 'buscar', label: 'Buscar Orden', icon: PackageSearch },
  { key: 'cotejar', label: 'Cotejar Lista', icon: FileSpreadsheet },
  { key: 'atp', label: 'Validación ATP', icon: Radar },
];

/** Normaliza el código de compañía para BigQuery (quita sufijos de vista) */
const toBQCompany = (company) => {
  let c = company.replace('_DECOMM', '').replace('_RECALC', '');
  if (c === 'SBB') c = 'SB';
  return c;
};

function App() {
  const [data, setData] = useState([]);
  const [previousData, setPreviousData] = useState([]);
  const [deliveryData, setDeliveryData] = useState(null); // { byDay, stores, totals }
  const [errorCodes, setErrorCodes] = useState(null); // { data, total } · tabs SBB/LP Decomm
  const [fsplit, setFsplit] = useState(null); // error por tipo de surtido · solo LP Decomm
  const [errorTrend, setErrorTrend] = useState(null); // serie diaria de errores · tabs Decomm
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [startDate, setStartDate] = useState(() => toISO(startOfMonth(today())));
  const [endDate, setEndDate] = useState(() => todayISO());
  const [company, setCompany] = useState('LP_DECOMM'); // LP_DECOMM, SBB_DECOMM, LP_RECALC, {SITE}_DECOMM
  const [view, setView] = useState('planes'); // 'planes' | 'entregas' | 'buscar' | 'cotejar'
  // Filtro de tipo de surtido: 'all' | 'Fulfillment_Type_Liverpool' | 'Liverpool_CNC_PICK_PACK'
  const [fulfillment, setFulfillment] = useState('all');
  // Filtro por tipo de producto (columna marketPlace, solo LP Decomm):
  // 'all' | 'true' (Marketplace) | 'false' (catálogo propio)
  const [marketplace, setMarketplace] = useState('all');
  // Mostrar/ocultar la serie % Error en la gráfica (solo tab SBB Decomm)
  const [showErrorSeries, setShowErrorSeries] = useState(true);
  const [activeQuick, setActiveQuick] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [csvExporting, setCsvExporting] = useState(false);
  const [csvExportError, setCsvExportError] = useState(null);

  /* ── Fetch principal + rango previo (para tendencias) ──
     Acepta un rango explícito (usado por los chips de rango rápido, que deben
     disparar la búsqueda de inmediato con las fechas recién calculadas, sin
     esperar a que el estado se actualice y este callback se re-cree). Si no
     se pasa nada, usa las fechas actuales en pantalla (botón Actualizar). */
  const fetchData = useCallback(async (range) => {
    const effectiveStart = range?.start ?? startDate;
    const effectiveEnd = range?.end ?? endDate;

    /* Las vistas Buscar Orden, Cotejar y Validación ATP manejan su propio fetch */
    if (view === 'buscar' || view === 'cotejar' || view === 'atp') {
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      /* Vista Tipos de Entrega: un solo fetch a /api/delivery-types */
      if (view === 'entregas') {
        const params = `?start=${effectiveStart}&end=${toApiEnd(effectiveEnd)}&company=${toBQCompany(company)}`;

        const res = await fetch(`/api/delivery-types${params}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setDeliveryData(json);
        return;
      }

      const prev = previousRange(effectiveStart, effectiveEnd);
      const isRecalc = company.includes('RECALC');
      const endpoint = isRecalc ? '/api/orders-recalculate' : '/api/orders-decomm';

      // Mapeo de compañías para BigQuery
      let finalCompany = company.replace('_DECOMM', '').replace('_RECALC', '');
      if (finalCompany === 'SBB') {
        finalCompany = 'SB';
      }

      let queryParams = `?start=${effectiveStart}&end=${toApiEnd(effectiveEnd)}&company=${finalCompany}`;
      let prevParams = `?start=${prev.start}&end=${toApiEnd(prev.end)}&company=${finalCompany}`;

      // El recalculo no tiene fulfillmentType en su payload
      if (fulfillment !== 'all' && !isRecalc) {
        queryParams += `&fulfillmentType=${fulfillment}`;
        prevParams += `&fulfillmentType=${fulfillment}`;
      }

      // Tipo de producto (marketPlace) · solo aplica al tab LP Decomm
      if (marketplace !== 'all' && company === 'LP_DECOMM') {
        queryParams += `&marketPlace=${marketplace}`;
        prevParams += `&marketPlace=${marketplace}`;
      }

      const [resCurr, resPrev] = await Promise.all([
        fetch(`${endpoint}${queryParams}`),
        fetch(`${endpoint}${prevParams}`).catch(() => null),
      ]);

      if (!resCurr.ok) {
        const err = await resCurr.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resCurr.status}`);
      }

      const json = await resCurr.json();
      setData(json.data || []);

      if (resPrev && resPrev.ok) {
        const jsonPrev = await resPrev.json();
        setPreviousData(jsonPrev.data || []);
      } else {
        setPreviousData([]);
      }

      /* Desglose por errorCode: lo muestran los tabs SBB Decomm y LP Decomm.
         Guardamos el query junto al resultado: si cambian las fechas sin pulsar
         Actualizar, la descarga por segmento sigue trayendo lo que está pintado. */
      if (company === 'SBB_DECOMM' || company === 'LP_DECOMM') {
        try {
          const p = new URLSearchParams({
            start: effectiveStart,
            end: toApiEnd(effectiveEnd),
            company: toBQCompany(company),
          });
          if (fulfillment !== 'all') p.set('fulfillmentType', fulfillment);
          if (company === 'LP_DECOMM' && marketplace !== 'all') p.set('marketPlace', marketplace);
          const errorCodesQuery = p.toString();

          const [resCodes, resTrend] = await Promise.all([
            fetch(`/api/error-codes?${errorCodesQuery}`),
            fetch(`/api/error-trend?${errorCodesQuery}`),
          ]);
          setErrorCodes(
            resCodes.ok ? { ...(await resCodes.json()), query: errorCodesQuery } : null
          );
          setErrorTrend(resTrend.ok ? await resTrend.json() : null);
        } catch {
          setErrorCodes(null); // el desglose es complementario: no rompe la vista
          setErrorTrend(null);
        }
      } else {
        setErrorCodes(null);
        setErrorTrend(null);
      }

      /* Comparativa de error por tipo de surtido: exclusiva de LP Decomm.
         No lleva el filtro de surtido (compara ambos), pero sí el de producto. */
      if (company === 'LP_DECOMM') {
        try {
          const p = new URLSearchParams({
            start: effectiveStart,
            end: toApiEnd(effectiveEnd),
            company: 'LP',
          });
          if (marketplace !== 'all') p.set('marketPlace', marketplace);
          const resSplit = await fetch(`/api/error-codes-fulfillment?${p}`);
          setFsplit(resSplit.ok ? { ...(await resSplit.json()), query: p.toString() } : null);
        } catch {
          setFsplit(null); // complementaria: no rompe la vista
        }
      } else {
        setFsplit(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, company, view, fulfillment, marketplace]);

  // Usa fetch (y no window.open) para no abrir una pestaña en blanco: así se
  // puede mostrar el spinner en el botón y quedarse en la misma página.
  const handleDownloadCSV = async () => {
    if (csvExporting) return;

    const isRecalc = company.includes('RECALC');
    const type = isRecalc ? 'recalc' : 'decomm';

    let finalCompany = company.replace('_DECOMM', '').replace('_RECALC', '');
    if (finalCompany === 'SBB') {
      finalCompany = 'SB';
    }

    let url = `/api/orders-csv?start=${startDate}&end=${toApiEnd(endDate)}&company=${finalCompany}&type=${type}`;
    if (fulfillment !== 'all' && !isRecalc) {
      url += `&fulfillmentType=${fulfillment}`;
    }
    if (marketplace !== 'all' && company === 'LP_DECOMM') {
      url += `&marketPlace=${marketplace}`;
    }

    setCsvExporting(true);
    setCsvExportError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const contentType = res.headers.get('content-type') || '';
        const message = contentType.includes('application/json')
          ? (await res.json())?.error
          : await res.text();
        throw new Error(message || `HTTP ${res.status}`);
      }

      const disposition = res.headers.get('content-disposition') || '';
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = match ? match[1] : 'reporte.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setCsvExportError(err.message);
    } finally {
      setCsvExporting(false);
    }
  };

  useEffect(() => {
    fetchData();
    // LP y Suburbia comparten el mismo color de marca (paleta "El Puerto de
    // Liverpool" del sistema de diseño), así que ya no hace falta alternar
    // --brand-primary por JS: queda fijo en :root (styles.css).
    document.documentElement.setAttribute('data-company', company);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, view, fulfillment, marketplace]);

  /* Reloj del header: un único intervalo durante toda la vida del componente */
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  /** Rango por defecto: primer día del mes en curso → hoy (el mismo con el que arranca la página) */
  const defaultRange = () => ({ start: toISO(startOfMonth(today())), end: todayISO() });

  /* ── Aplicar / quitar un rango rápido ──
     Ambas acciones disparan la búsqueda de inmediato, con las fechas recién
     calculadas (no las del estado, que todavía no se actualizó). Volver a
     hacer click en el chip ya activo lo desmarca y regresa al rango por
     defecto, también consultando de inmediato. */
  const handleQuickRange = (range) => {
    let start, end, nextActive;

    if (activeQuick === range.key) {
      ({ start, end } = defaultRange());
      nextActive = null;
    } else {
      const today_ = today();
      let startDateObj, endDateObj;
      if (range.key === 'mtd') {
        startDateObj = startOfMonth(today_);
        endDateObj = today_;
      } else if (range.days === 0) {
        startDateObj = today_;
        endDateObj = today_;
      } else {
        endDateObj = today_;
        startDateObj = addDays(today_, -range.days);
      }
      start = toISO(startDateObj);
      end = toISO(endDateObj);
      nextActive = range.key;
    }

    setStartDate(start);
    setEndDate(end);
    setActiveQuick(nextActive);
    fetchData({ start, end });
  };

  const handleDateChange = (setter) => (isoValue) => {
    setter(isoValue);
    setActiveQuick(null);
  };

  const switchView = (v) => {
    setView(v);
  };

  /* Vistas globales: no dependen de compañía ni de rango de fechas */
  const isGlobalView = view === 'buscar' || view === 'cotejar' || view === 'atp';

  const rangeLabel = useMemo(() => {
    const opts = { day: '2-digit', month: 'short', year: 'numeric' };
    const s = fromISO(startDate).toLocaleDateString('es-MX', opts);
    const e = fromISO(endDate).toLocaleDateString('es-MX', opts);
    return `${s} → ${e}`;
  }, [startDate, endDate]);

  /* Formateadores del reloj: se construyen una sola vez, se reutilizan cada tick */
  const clockDateFmt = useMemo(
    () => new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }),
    []
  );
  const clockTimeFmt = useMemo(
    () => new Intl.DateTimeFormat('es-MX', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }),
    []
  );

  const reportSource = useMemo(() => {
    if (view === 'atp') return 'FAC_EDD_ORDERS_TRN → OMS EPLInventoryAvailabilityWebService';
    if (view === 'buscar' || view === 'cotejar' || view === 'entregas') return 'FAC_EDD_ORDERS_TRN';
    return company.includes('RECALC') ? 'FAC_EDD_RECALCULATE_TRN' : 'FAC_EDD_ORDERS_TRN';
  }, [company, view]);

  /* Descripción de la vista activa · se muestra en el footer (el header, igual
     al de Conecta, ya no lleva subtítulo) */
  const viewDescription = useMemo(() => {
    if (view === 'atp') return 'Errores del query de decomm validados contra el OMS de Suburbia (disponibilidad ATP)';
    if (view === 'cotejar') return 'Sube tu lista de órdenes y cotéjala: errorCode, porcentajes y no encontradas';
    if (view === 'buscar') return 'Consulta una orden o remisión: SKUs, tiendas, fechas estimadas y tipo de entrega';
    if (view === 'entregas') return 'Tipos de entrega (Flash, Siguiente Día, Estándar) y asignaciones por tienda';
    return 'Distribución diaria de pedidos por plan: A, B y Error';
  }, [view]);

  return (
    <>
      {/* ─── Header (idéntico al de Conecta, ancho completo) ─── */}
      <header className="app-header">
        <div className="app-header__inner">
          <div className="app-header__brand">
            <img src={liverpoolLogo} alt="Liverpool" className="app-header__logo" />
            <span className="app-header__divider" aria-hidden="true" />
            <h1>Fecha Estimada de Entrega</h1>
          </div>

          <div className="app-header__meta">
            <span className="dot" aria-hidden="true" />
            <Clock size={12} />
            <time dateTime={now.toISOString()}>
              {clockDateFmt.format(now)} · {clockTimeFmt.format(now)}
            </time>
          </div>
        </div>
      </header>

      <div className="app-shell">
      <Sidebar
        items={SIDEBAR_ITEMS}
        view={view}
        onSelectView={switchView}
        company={company}
        onSelectCompany={setCompany}
      />

      <div className="container">
      {/* ─── Filtros (las vistas globales no usan rango de fechas) ─── */}
      {!isGlobalView && (
      <div className="filters-card">
        <div className="quick-ranges" role="group" aria-label="Rangos rápidos">
          <span className="quick-ranges__label">
            <CalendarDays size={12} /> Rango rápido
          </span>
          {QUICK_RANGES.map((r) => (
            <button
              key={r.key}
              className={`chip ${activeQuick === r.key ? 'active' : ''}`}
              onClick={() => handleQuickRange(r)}
              type="button"
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Filtro de tipo de surtido (solo vista Planes; el recalculo no lo trae) */}
        {view === 'planes' && (
          <div className="quick-ranges" role="group" aria-label="Tipo de surtido">
            <span className="quick-ranges__label">
              <Truck size={12} /> Surtido
            </span>
            <button
              type="button"
              className={`chip ${fulfillment === 'all' ? 'active' : ''}`}
              onClick={() => setFulfillment('all')}
              disabled={company.includes('RECALC')}
            >
              Todos
            </button>
            <button
              type="button"
              className={`chip ${fulfillment === 'Fulfillment_Type_Liverpool' ? 'active' : ''}`}
              onClick={() => setFulfillment('Fulfillment_Type_Liverpool')}
              disabled={company.includes('RECALC')}
              title="Fulfillment_Type_Liverpool"
            >
              <Home size={12} />
              Entrega a domicilio
            </button>
            <button
              type="button"
              className={`chip ${fulfillment === 'Liverpool_CNC_PICK_PACK' ? 'active' : ''}`}
              onClick={() => setFulfillment('Liverpool_CNC_PICK_PACK')}
              disabled={company.includes('RECALC')}
              title="Liverpool_CNC_PICK_PACK"
            >
              <Store size={12} />
              Click & Collect (tienda)
            </button>
            {company.includes('RECALC') && (
              <span className="quick-ranges__note">
                No aplica al recalculo
              </span>
            )}
          </div>
        )}

        {/* Filtro por tipo de producto (marketPlace) · exclusivo del tab LP Decomm */}
        {view === 'planes' && company === 'LP_DECOMM' && (
          <div className="quick-ranges" role="group" aria-label="Tipo de producto">
            <span className="quick-ranges__label">
              <ShoppingBag size={12} /> Producto
            </span>
            <button
              type="button"
              className={`chip ${marketplace === 'all' ? 'active' : ''}`}
              onClick={() => setMarketplace('all')}
            >
              Todos
            </button>
            <button
              type="button"
              className={`chip ${marketplace === 'true' ? 'active' : ''}`}
              onClick={() => setMarketplace('true')}
              title="marketPlace = true"
            >
              <ShoppingBag size={12} />
              Marketplace
            </button>
            <button
              type="button"
              className={`chip ${marketplace === 'false' ? 'active' : ''}`}
              onClick={() => setMarketplace('false')}
              title="marketPlace = false"
            >
              <Store size={12} />
              Catálogo propio
            </button>
          </div>
        )}

        {/* Filtro de boutique · exclusivo del dashboard "Boutiques"
            (agrupa lo que antes eran los tabs WS/DCK/GAP/PB/PBK/BRU Decomm) */}
        {view === 'planes' && MULTISITE_DECOMM.some((site) => company === `${site}_DECOMM`) && (
          <div className="quick-ranges" role="group" aria-label="Boutique">
            <span className="quick-ranges__label">
              <Store size={12} /> Boutique
            </span>
            {MULTISITE_DECOMM.map((site) => (
              <button
                key={site}
                type="button"
                className={`chip ${company === `${site}_DECOMM` ? 'active' : ''}`}
                onClick={() => setCompany(`${site}_DECOMM`)}
              >
                {BOUTIQUE_LABELS[site]}
              </button>
            ))}
          </div>
        )}

        <div className="filters">
          <div className="field">
            <label htmlFor="start-date">Desde</label>
            <CalendarWidget
              id="start-date"
              value={startDate}
              onChange={handleDateChange(setStartDate)}
              label="Fecha desde"
            />
          </div>

          <div className="field">
            <label htmlFor="end-date">Hasta</label>
            <CalendarWidget
              id="end-date"
              value={endDate}
              onChange={handleDateChange(setEndDate)}
              label="Fecha hasta"
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <button
              className="btn-primary"
              onClick={() => fetchData()}
              onMouseDown={addRipple}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Cargando…
                </>
              ) : (
                <>
                  <RefreshCcw size={15} strokeWidth={2.4} />
                  Actualizar
                </>
              )}
            </button>
            {view === 'planes' && (
            <button
              className="btn-secondary"
              onClick={handleDownloadCSV}
              onMouseDown={addRipple}
              disabled={loading || csvExporting || data.length === 0}
              title="Descargar pedidos con Error o Plan B en CSV"
            >
              {csvExporting ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Exportando…
                </>
              ) : (
                <>
                  <Download size={15} strokeWidth={2.4} />
                  Exportar
                </>
              )}
            </button>
            )}
          </div>
        </div>
        {view === 'planes' && (
          <p className="csv-export-hint">
            <Info size={13} strokeWidth={2.2} />
            <span>El CSV exportado solo incluye pedidos con Error o Plan B.</span>
          </p>
        )}
        {csvExportError && (
          <p className="csv-export-error" role="alert">
            <AlertCircle size={14} strokeWidth={2.2} />
            <span>No se pudo exportar el CSV: {csvExportError}</span>
          </p>
        )}
      </div>
      )}

      {/* ─── Vista Buscar Orden ─── */}
      {view === 'buscar' && <OrderSearch />}

      {/* ─── Vista Cotejar Lista ─── */}
      {view === 'cotejar' && <BulkOrderCheck />}

      {/* ─── Vista Validación ATP (decomm → OMS Suburbia) ─── */}
      {view === 'atp' && <AtpDecomm />}

      {/* ─── Estados ─── */}
      {!isGlobalView && error && (
        <div className="alert alert--error" role="alert">
          <AlertCircle className="alert__icon" size={18} />
          <div>
            <strong>Error al cargar datos.</strong> {error}
          </div>
        </div>
      )}

      {!isGlobalView && loading && (
        <>
          <KpiSkeleton />
          <ChartSkeleton />
        </>
      )}

      {!loading && !error &&
        ((view === 'planes' && data.length === 0) ||
          (view === 'entregas' && (!deliveryData || deliveryData.byDay.length === 0))) && (
        <div className="alert alert--empty">
          <Inbox className="alert__icon" size={18} />
          <div>
            <strong>Sin datos.</strong> No hay registros para el rango
            seleccionado. Ajusta las fechas o cambia de compañía.
          </div>
        </div>
      )}

      {!loading && !error && view === 'planes' && data.length > 0 && (
        <>
          <KpiCards data={data} previousData={previousData} />

          <div className="chart-card">
            <div className="chart-card__head">
              <div>
                <h2>
                  <BarChart3 size={18} strokeWidth={2.2} />
                  Distribución diaria por plan
                </h2>
                <p className="subtitle">
                  Composición porcentual (100% apilado) por día
                  {company === 'LP_DECOMM' && marketplace !== 'all'
                    ? ` · solo ${marketplace === 'true' ? 'Marketplace' : 'catálogo propio'}`
                    : ''}
                  {company === 'SBB_DECOMM' && !showErrorSeries
                    ? ' · serie % Error oculta'
                    : ''}
                </p>
              </div>
              {company === 'SBB_DECOMM' && (
                <button
                  type="button"
                  className={`chip ${showErrorSeries ? '' : 'active'}`}
                  onClick={() => setShowErrorSeries((v) => !v)}
                  title="Mostrar u ocultar la serie % Error en la gráfica"
                >
                  {showErrorSeries ? (
                    <>
                      <EyeOff size={12} /> Ocultar % Error
                    </>
                  ) : (
                    <>
                      <Eye size={12} /> Mostrar % Error
                    </>
                  )}
                </button>
              )}
            </div>
            <BarChart
              data={data}
              hideError={company === 'SBB_DECOMM' && !showErrorSeries}
            />
          </div>

          {/* Desglose de errorCode · tabs SBB Decomm y LP Decomm */}
          {(company === 'SBB_DECOMM' || company === 'LP_DECOMM') && errorCodes && (
            <div className="chart-card">
              <div className="chart-card__head">
                <div>
                  <h2>
                    <PieChart size={18} strokeWidth={2.2} />
                    Composición del % Error por errorCode
                  </h2>
                  <p className="subtitle">
                    Reparto de los {errorCodes.total.toLocaleString('es-MX')} registros
                    clasificados como Error en {rangeLabel}
                    {fulfillment !== 'all'
                      ? ` · ${
                          fulfillment === 'Liverpool_CNC_PICK_PACK'
                            ? 'CNC Pick & Pack'
                            : 'Surtido Liverpool'
                        }`
                      : ''}
                    {company === 'LP_DECOMM' && marketplace !== 'all'
                      ? ` · solo ${marketplace === 'true' ? 'Marketplace' : 'catálogo propio'}`
                      : ''}
                    {' · '}descarga los registros de cada segmento con
                    <Download size={12} strokeWidth={2.4} className="subtitle__icon" />
                  </p>
                </div>
              </div>
              <ErrorCodePie
                data={errorCodes.data}
                total={errorCodes.total}
                csvQuery={errorCodes.query}
              />
            </div>
          )}

          {/* Tendencia diaria de errores · tabs SBB Decomm y LP Decomm */}
          {(company === 'SBB_DECOMM' || company === 'LP_DECOMM') &&
            errorTrend &&
            errorTrend.days?.length > 0 && (
            <div className="chart-card">
              <div className="chart-card__head">
                <div>
                  <h2>
                    <TrendingUp size={18} strokeWidth={2.2} />
                    Comportamiento diario de los errores
                  </h2>
                  <p className="subtitle">
                    Evolución por causal — top 5 + Otros, con los mismos colores del catálogo que
                    la dona · aplica los mismos filtros de surtido
                    {company === 'LP_DECOMM' ? ' y producto' : ''} · pasa el cursor sobre un día
                    para ver todas las series
                  </p>
                </div>
              </div>
              <ErrorTrendChart days={errorTrend.days} codes={errorTrend.codes} />
            </div>
          )}

          {/* Error por tipo de surtido · exclusivo de LP Decomm */}
          {company === 'LP_DECOMM' && fsplit && (
            <div className="chart-card">
              <div className="chart-card__head">
                <div>
                  <h2>
                    <Truck size={18} strokeWidth={2.2} />
                    Error por tipo de surtido
                  </h2>
                  <p className="subtitle">
                    Entrega a domicilio vs Click &amp; Collect: tasa de error de cada segmento y
                    sus causales lado a lado
                    {marketplace !== 'all'
                      ? ` · solo ${marketplace === 'true' ? 'Marketplace' : 'catálogo propio'}`
                      : ''}
                    {' '}· esta comparativa ignora el filtro de surtido de arriba
                  </p>
                </div>
              </div>
              <ErrorFulfillmentSplit data={fsplit.segments} csvQuery={fsplit.query} />
            </div>
          )}
        </>
      )}

      {!loading && !error && view === 'entregas' && deliveryData && deliveryData.byDay.length > 0 && (
        <>
          <DeliveryKpis totals={deliveryData.totals} />

          <div className="chart-card">
            <div className="chart-card__head">
              <div>
                <h2>
                  <Zap size={18} strokeWidth={2.2} />
                  Distribución diaria por tipo de entrega
                </h2>
                <p className="subtitle">
                  Flash Mismo Día (edd1 = edd2 = día de compra) · Siguiente
                  Día (edd1 = edd2 = día +1) · Estándar (edd1 ≠ edd2) · 100% apilado
                </p>
              </div>
            </div>
            <DeliveryChart data={deliveryData.byDay} />
          </div>

          <div className="chart-card">
            <div className="chart-card__head">
              <div>
                <h2>
                  <Store size={18} strokeWidth={2.2} />
                  Asignaciones por tienda
                </h2>
                <p className="subtitle">
                  Tienda que asignó la mercancía por línea (columna origen)
                </p>
              </div>
            </div>
            <StoreRanking stores={deliveryData.stores} />
          </div>
        </>
      )}

      <footer>
        {viewDescription} · Fuente: <code>{reportSource}</code> · Hora local: América/México
      </footer>
      </div>
      </div>
    </>
  );
}

export default App;