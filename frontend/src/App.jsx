import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  Calendar,
  CalendarDays,
  RefreshCcw,
  AlertCircle,
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

/* ───────────────────────── helpers ───────────────────────── */
const toISO = (d) => d.toISOString().slice(0, 10);

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
  const s = new Date(startISO);
  const e = new Date(endISO);
  const days = Math.max(1, Math.round((e - s) / 86400000) + 1);
  const prevEnd = addDays(s, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return { start: toISO(prevStart), end: toISO(prevEnd) };
};

/* ───────────────────────── config ────────────────────────── */
const QUICK_RANGES = [
  { key: 'today', label: 'Hoy', days: 0 },
  { key: '7d', label: 'Últimos 7 días', days: 6 },
  { key: '30d', label: 'Últimos 30 días', days: 29 },
  { key: 'mtd', label: 'Este mes', days: null },
];

const MULTISITE_DECOMM = ['WS', 'DCK', 'GAP', 'PB', 'PBK', 'BRU'];

/** Normaliza el código de compañía para BigQuery (quita sufijos de vista) */
const toBQCompany = (company) => {
  let c = company
    .replace('_DECOMM', '')
    .replace('_RECALC', '')
    .replace('_BT_ATG', '')
    .replace('_BT_DECOMM', '');
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
  const [startDate, setStartDate] = useState('2026-04-01');
  const [endDate, setEndDate] = useState('2026-05-27');
  const [company, setCompany] = useState('LP'); // LP, SBB, LP_DECOMM, LP_BT_ATG, LP_BT_DECOMM, etc.
  const [view, setView] = useState('planes'); // 'planes' | 'entregas' | 'buscar' | 'cotejar'
  // Filtro de tipo de surtido: 'all' | 'Fulfillment_Type_Liverpool' | 'Liverpool_CNC_PICK_PACK'
  const [fulfillment, setFulfillment] = useState('all');
  // Filtro por tipo de producto (columna marketPlace, solo LP Decomm):
  // 'all' | 'true' (Marketplace) | 'false' (catálogo propio)
  const [marketplace, setMarketplace] = useState('all');
  // Mostrar/ocultar la serie % Error en la gráfica (solo tab SBB Decomm)
  const [showErrorSeries, setShowErrorSeries] = useState(true);
  const [activeQuick, setActiveQuick] = useState(null);

  /* Parámetros del desglose por errorCode. Los comparten el fetch de la dona
     y la descarga de cada segmento, así el CSV siempre corresponde a lo que
     está en pantalla (rango, compañía y tipo de surtido). */
  const errorCodesQuery = useMemo(() => {
    const p = new URLSearchParams({
      start: startDate,
      end: endDate,
      company: toBQCompany(company),
    });
    if (company.includes('_BT_')) p.set('productType', 'Big Ticket');
    if (fulfillment !== 'all') p.set('fulfillmentType', fulfillment);
    if (company === 'LP_DECOMM' && marketplace !== 'all') p.set('marketPlace', marketplace);
    return p.toString();
  }, [startDate, endDate, company, fulfillment, marketplace]);

  /* ── Fetch principal + rango previo (para tendencias) ── */
  const fetchData = useCallback(async () => {
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
        const isBT = company.includes('_BT_');
        let params = `?start=${startDate}&end=${endDate}&company=${toBQCompany(company)}`;
        if (isBT) params += '&productType=Big Ticket';

        const res = await fetch(`/api/delivery-types${params}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setDeliveryData(json);
        return;
      }

      const prev = previousRange(startDate, endDate);
      const isDecomm = company.includes('DECOMM') || company === 'LP_BT_DECOMM';
      const isRecalc = company.includes('RECALC');
      const isBT = company.includes('_BT_');
      
      let endpoint = '/api/orders-summary';
      if (isDecomm) endpoint = '/api/orders-decomm';
      if (isRecalc) endpoint = '/api/orders-recalculate';

      // Mapeo de compañías para BigQuery
      let finalCompany = company.replace('_DECOMM', '').replace('_RECALC', '').replace('_BT_ATG', '').replace('_BT_DECOMM', '');
      if ((isDecomm || isRecalc) && finalCompany === 'SBB') {
        finalCompany = 'SB';
      }

      let queryParams = `?start=${startDate}&end=${endDate}&company=${finalCompany}`;
      let prevParams = `?start=${prev.start}&end=${prev.end}&company=${finalCompany}`;

      if (isBT) {
        queryParams += '&productType=Big Ticket';
        prevParams += '&productType=Big Ticket';
      }

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
          const p = new URLSearchParams({ start: startDate, end: endDate, company: 'LP' });
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
  }, [startDate, endDate, company, view, fulfillment, marketplace, errorCodesQuery]);

  const handleDownloadCSV = () => {
    const isDecomm = company.includes('DECOMM') || company === 'LP_BT_DECOMM';
    const isRecalc = company.includes('RECALC');
    const isBT = company.includes('_BT_');
    
    let type = 'summary';
    if (isDecomm) type = 'decomm';
    if (isRecalc) type = 'recalc';

    let finalCompany = company.replace('_DECOMM', '').replace('_RECALC', '').replace('_BT_ATG', '').replace('_BT_DECOMM', '');
    if ((isDecomm || isRecalc) && finalCompany === 'SBB') {
      finalCompany = 'SB';
    }

    let url = `/api/orders-csv?start=${startDate}&end=${endDate}&company=${finalCompany}&type=${type}`;
    if (isBT) {
      url += '&productType=Big Ticket';
    }
    if (fulfillment !== 'all' && !isRecalc) {
      url += `&fulfillmentType=${fulfillment}`;
    }
    if (marketplace !== 'all' && company === 'LP_DECOMM') {
      url += `&marketPlace=${marketplace}`;
    }
    window.open(url, '_blank');
  };

  useEffect(() => {
    fetchData();
    // Color de marca dinámico + data-attribute para el tema
    const isLP = company.startsWith('LP');
    const brandColor = isLP ? '#e10098' : '#552166';
    const brandRgb = isLP ? '225, 0, 152' : '85, 33, 102';
    document.documentElement.style.setProperty('--brand-primary', brandColor);
    document.documentElement.style.setProperty('--brand-primary-rgb', brandRgb);
    // Serie Flash en gráficas: el morado de marca es muy oscuro para marcas
    // de datos, se usa un paso más claro del mismo tono (paleta validada).
    document.documentElement.style.setProperty(
      '--viz-flash',
      isLP ? '#e10098' : '#8347ad'
    );
    document.documentElement.setAttribute('data-company', company);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, view, fulfillment, marketplace]);

  /* ── Aplicar quick range ── */
  const applyQuickRange = (range) => {
    const today = new Date('2026-05-27'); // En prod: new Date()
    let start, end;
    if (range.key === 'mtd') {
      start = startOfMonth(today);
      end = today;
    } else if (range.days === 0) {
      start = today;
      end = today;
    } else {
      end = today;
      start = addDays(today, -range.days);
    }
    setStartDate(toISO(start));
    setEndDate(toISO(end));
    setActiveQuick(range.key);
  };

  const handleDateChange = (setter) => (e) => {
    setter(e.target.value);
    setActiveQuick(null);
  };

  /* ── Cambiar de vista normalizando pestañas que no aplican ── */
  const switchView = (v) => {
    if (v === 'entregas') {
      // La vista de entregas siempre lee FAC_EDD_ORDERS_TRN (Decomm):
      // ATG y Recalculo no aplican, y los tabs Decomm duplican LP/SBB.
      if (company === 'LP_BT_ATG') setCompany('LP_BT_DECOMM');
      else if (company === 'LP_RECALC' || company === 'LP_DECOMM') setCompany('LP');
      else if (company === 'SBB_DECOMM') setCompany('SBB');
    }
    setView(v);
  };

  /* Vistas globales: no dependen de compañía ni de rango de fechas */
  const isGlobalView = view === 'buscar' || view === 'cotejar' || view === 'atp';

  const rangeLabel = useMemo(() => {
    const opts = { day: '2-digit', month: 'short', year: 'numeric' };
    const s = new Date(startDate).toLocaleDateString('es-MX', opts);
    const e = new Date(endDate).toLocaleDateString('es-MX', opts);
    return `${s} → ${e}`;
  }, [startDate, endDate]);

  const siteTitle = useMemo(() => {
    if (company === 'LP_BT_ATG') return 'Liverpool (BT ATG)';
    if (company === 'LP_BT_DECOMM') return 'Liverpool (BT Decomm)';
    if (company.startsWith('LP')) return 'Liverpool';
    if (company.startsWith('SBB')) return 'Suburbia';
    return company.replace('_DECOMM', '').replace('_RECALC', '');
  }, [company]);

  const reportSource = useMemo(() => {
    if (view === 'atp') return 'FAC_EDD_ORDERS_TRN → OMS EPLInventoryAvailabilityWebService';
    if (view === 'buscar' || view === 'cotejar') return 'FAC_EDD_ORDERS_TRN';
    if (view === 'entregas') {
      return company.includes('_BT_')
        ? 'FAC_EDD_ORDERS_TRN (Big Ticket)'
        : 'FAC_EDD_ORDERS_TRN';
    }
    if (company === 'LP_BT_ATG') return 'tables_raw_changelog (Big Ticket)';
    if (company === 'LP_BT_DECOMM') return 'FAC_EDD_ORDERS_TRN (Big Ticket)';
    if (company.includes('RECALC')) return 'FAC_EDD_RECALCULATE_TRN';
    if (company.includes('DECOMM')) return 'FAC_EDD_ORDERS_TRN';
    return 'tables_raw_changelog';
  }, [company, view]);

  return (
    <div className="container">
      {/* ─── Header ─── */}
      <header className="app-header">
        <div className="app-header__title">
          <div className="app-header__logo">
            <Activity size={22} strokeWidth={2.2} />
          </div>
          <div>
            <h1>
              {view === 'atp' ? (
                'Reporte Ejecutivo · Validación ATP Decomm'
              ) : (
                <>
                  Reporte Ejecutivo · Pedidos {siteTitle}
                  {view === 'planes' && company.includes('DECOMM') && !company.includes('_BT_') ? ' (Decomm)' : ''}
                  {view === 'planes' && company.includes('RECALC') ? ' (Recalculo)' : ''}
                </>
              )}
            </h1>
            <p className="subtitle">
              {view === 'atp'
                ? `Errores del query de decomm validados contra el OMS de Suburbia (disponibilidad ATP, timeout 20 s) · ${reportSource}`
                : view === 'cotejar'
                ? `Sube tu lista de órdenes y cotéjala: errorCode, porcentajes y no encontradas · ${reportSource}`
                : view === 'buscar'
                ? `Consulta una orden o remisión: SKUs, tiendas, fechas estimadas y tipo de entrega · ${reportSource}`
                : view === 'entregas'
                ? `Tipos de entrega (Flash, Siguiente Día, Estándar) y asignaciones por tienda · ${reportSource}`
                : `Distribución diaria de pedidos por plan: A, B y Error · ${reportSource}`}
            </p>
          </div>
        </div>

        <div className="app-header__meta">
          <span className="dot" aria-hidden="true" />
          <Clock size={12} />
          <span>{view === 'atp' ? 'Rango en la vista' : isGlobalView ? 'Últimos 6 meses' : rangeLabel}</span>
        </div>
      </header>

      {/* ─── Selector de vista ─── */}
      <div className="view-switch" role="tablist" aria-label="Vista">
        <button
          role="tab"
          aria-selected={view === 'planes'}
          className={`view-switch__btn ${view === 'planes' ? 'active' : ''}`}
          onClick={() => switchView('planes')}
        >
          <Layers size={14} strokeWidth={2.2} />
          Planes A / B
        </button>
        <button
          role="tab"
          aria-selected={view === 'entregas'}
          className={`view-switch__btn ${view === 'entregas' ? 'active' : ''}`}
          onClick={() => switchView('entregas')}
        >
          <Zap size={14} strokeWidth={2.2} />
          Tipos de Entrega
        </button>
        <button
          role="tab"
          aria-selected={view === 'buscar'}
          className={`view-switch__btn ${view === 'buscar' ? 'active' : ''}`}
          onClick={() => switchView('buscar')}
        >
          <PackageSearch size={14} strokeWidth={2.2} />
          Buscar Orden
        </button>
        <button
          role="tab"
          aria-selected={view === 'cotejar'}
          className={`view-switch__btn ${view === 'cotejar' ? 'active' : ''}`}
          onClick={() => switchView('cotejar')}
        >
          <FileSpreadsheet size={14} strokeWidth={2.2} />
          Cotejar Lista
        </button>
        <button
          role="tab"
          aria-selected={view === 'atp'}
          className={`view-switch__btn ${view === 'atp' ? 'active' : ''}`}
          onClick={() => switchView('atp')}
        >
          <Radar size={14} strokeWidth={2.2} />
          Validación ATP
        </button>
      </div>

      {/* ─── Tabs compañía (no aplican a las vistas globales) ─── */}
      {!isGlobalView && (
      <div className="tabs" role="tablist" aria-label="Compañía">
        {/* Principales */}
        <button
          role="tab"
          aria-selected={company === 'LP'}
          className={`tab-btn ${company === 'LP' ? 'active' : ''}`}
          onClick={() => setCompany('LP')}
        >
          Liverpool · LP
        </button>
        <button
          role="tab"
          aria-selected={company === 'SBB'}
          className={`tab-btn ${company === 'SBB' ? 'active' : ''}`}
          onClick={() => setCompany('SBB')}
        >
          Suburbia · SBB
        </button>

        {/* Bigticket */}
        {view === 'planes' && (
          <button
            role="tab"
            aria-selected={company === 'LP_BT_ATG'}
            className={`tab-btn ${company === 'LP_BT_ATG' ? 'active' : ''}`}
            onClick={() => setCompany('LP_BT_ATG')}
          >
            BT ATG
          </button>
        )}
        <button
          role="tab"
          aria-selected={company === 'LP_BT_DECOMM'}
          className={`tab-btn ${company === 'LP_BT_DECOMM' ? 'active' : ''}`}
          onClick={() => setCompany('LP_BT_DECOMM')}
        >
          BT Decomm
        </button>

        {/* Decomm Principales (en Tipos de Entrega LP/SBB ya son Decomm) */}
        {view === 'planes' && (
          <>
            <button
              role="tab"
              aria-selected={company === 'LP_DECOMM'}
              className={`tab-btn ${company === 'LP_DECOMM' ? 'active' : ''}`}
              onClick={() => setCompany('LP_DECOMM')}
            >
              LP Decomm
            </button>
            <button
              role="tab"
              aria-selected={company === 'SBB_DECOMM'}
              className={`tab-btn ${company === 'SBB_DECOMM' ? 'active' : ''}`}
              onClick={() => setCompany('SBB_DECOMM')}
            >
              SBB Decomm
            </button>

            {/* Recalculo */}
            <button
              role="tab"
              aria-selected={company === 'LP_RECALC'}
              className={`tab-btn ${company === 'LP_RECALC' ? 'active' : ''}`}
              onClick={() => setCompany('LP_RECALC')}
            >
              Recalculo Decomm
            </button>
          </>
        )}

        {/* Multisite Decomm */}
        {MULTISITE_DECOMM.map((site) => (
          <button
            key={site}
            role="tab"
            aria-selected={company === `${site}_DECOMM`}
            className={`tab-btn ${company === `${site}_DECOMM` ? 'active' : ''}`}
            onClick={() => setCompany(`${site}_DECOMM`)}
          >
            {site} Decomm
          </button>
        ))}
      </div>
      )}

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
              onClick={() => applyQuickRange(r)}
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

        <div className="filters">
          <div className="field">
            <label htmlFor="start-date">Desde</label>
            <div className="input-wrap">
              <Calendar className="input-wrap__icon" size={16} />
              <input
                id="start-date"
                type="date"
                value={startDate}
                onChange={handleDateChange(setStartDate)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="end-date">Hasta</label>
            <div className="input-wrap">
              <Calendar className="input-wrap__icon" size={16} />
              <input
                id="end-date"
                type="date"
                value={endDate}
                onChange={handleDateChange(setEndDate)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <button
              className="btn-primary"
              onClick={fetchData}
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
              disabled={loading || data.length === 0}
              title="Descargar pedidos con Error o Plan B en CSV"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0 16px',
                height: '38px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--surface-color)',
                color: 'var(--text-color)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500',
              }}
            >
              <Download size={15} strokeWidth={2.4} />
              Exportar
            </button>
            )}
          </div>
        </div>
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
        Fuente: <code>{reportSource}</code> · Hora local: América/México
      </footer>
    </div>
  );
}

export default App;