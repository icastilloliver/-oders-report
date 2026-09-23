import DateRange from './DateRange.jsx';
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  Zap,
  CalendarClock,
  Truck,
  AlertTriangle,
  Store,
  MapPin,
  CreditCard,
  Smartphone,
  Globe,
  Copy,
  Check,
  PackageSearch,
  Package,
  Split,
  History,
  X,
  Tag,
  Hash,
  Info,
} from 'lucide-react';

/* ─────────────────── helpers ─────────────────── */
const monthAbbr = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

const fmtDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${monthAbbr[parseInt(m, 10) - 1]}`;
};

const fmtDateTime = (str) => {
  // "2026-08-02 17:55:23" → "2 ago 2026 · 17:55:23"
  if (!str) return '—';
  const [date, time] = str.split(' ');
  const [y, m, d] = date.split('-');
  return `${parseInt(d, 10)} ${monthAbbr[parseInt(m, 10) - 1]} ${y} · ${time} h`;
};

const titleCase = (s) =>
  s
    ? s
        .toLowerCase()
        .split(' ')
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ')
    : '';

const DELIVERY_TYPES = {
  flash: { label: 'Flash Mismo Día', icon: Zap, className: 'badge--flash' },
  siguiente_dia: { label: 'Siguiente Día', icon: CalendarClock, className: 'badge--nextday' },
  estandar: { label: 'Estándar', icon: Truck, className: 'badge--standard' },
  sin_edd: { label: 'Sin EDD', icon: AlertTriangle, className: 'badge--noedd' },
};

const RECENT_KEY = 'orderSearchRecent';

const loadRecent = () => {
  try {
    const raw = JSON.parse(sessionStorage.getItem(RECENT_KEY)) || [];
    // Compat: antes se guardaban strings (solo órdenes)
    return raw.map((r) => (typeof r === 'string' ? { m: 'orden', q: r } : r));
  } catch {
    return [];
  }
};

/** 'Hasta' inclusivo: el backend usa fin EXCLUSIVO, se manda el día siguiente */
const nextDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

/* ─────────────────── subcomponentes ─────────────────── */

function CopyButton({ value, title }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard no disponible */
    }
  };
  return (
    <button type="button" className="copy-btn" onClick={copy} title={title}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function DeliveryBadge({ tipo }) {
  const t = DELIVERY_TYPES[tipo] || DELIVERY_TYPES.estandar;
  const Icon = t.icon;
  return (
    <span className={`badge ${t.className}`}>
      <Icon size={11} strokeWidth={2.4} />
      {t.label}
    </span>
  );
}

/** Riel de promesa: una píldora si edd1 = edd2, dos conectadas si es rango */
function PromiseRail({ edd1, edd2 }) {
  if (!edd1 || !edd2) {
    return <span className="promise-rail promise-rail--empty">Sin fechas estimadas</span>;
  }
  if (edd1 === edd2) {
    return (
      <span className="promise-rail">
        <span className="promise-rail__pill promise-rail__pill--single">
          {fmtDate(edd1)}
        </span>
      </span>
    );
  }
  return (
    <span className="promise-rail">
      <span className="promise-rail__pill">{fmtDate(edd1)}</span>
      <span className="promise-rail__track" aria-hidden="true" />
      <span className="promise-rail__pill">{fmtDate(edd2)}</span>
    </span>
  );
}

function LineCard({ line, index }) {
  const qty = Number(line.quantity) || 1;
  const hasError = String(line.hasError) === 'true';
  return (
    <li className="line-card" style={{ '--i': index }}>
      <div className="line-card__sku">
        <span className="line-card__sku-label">SKU</span>
        <span className="line-card__sku-value">{line.sku}</span>
        <span className="line-card__qty">
          {qty} {qty === 1 ? 'pieza' : 'piezas'}
        </span>
      </div>

      <div className="line-card__store">
        <Store size={13} strokeWidth={2.2} />
        {line.origen ? `Tienda ${line.origen}` : 'Marketplace'}
        {line.storeSelected && (
          <span className="line-card__pickup">→ recoge en {line.storeSelected}</span>
        )}
      </div>

      <PromiseRail edd1={line.edd1} edd2={line.edd2} />

      <div className="line-card__badges">
        <DeliveryBadge tipo={line.tipoEntrega} />
        <span
          className={`badge ${
            hasError
              ? 'badge--noedd'
              : line.plan === 'B'
              ? 'badge--planb'
              : 'badge--plan'
          }`}
        >
          {hasError ? (
            <>
              <AlertTriangle size={11} strokeWidth={2.4} />
              Error {line.errorCode}
            </>
          ) : (
            <>
              <Check size={11} strokeWidth={2.8} />
              Plan {line.plan || '—'}
            </>
          )}
        </span>
      </div>
    </li>
  );
}

/* ─────────────────── resultados por SKU ─────────────────── */

/** Tabla de líneas de un SKU a través de órdenes; la remisión es clickeable
    y salta a la búsqueda por orden para ver el detalle completo. */
function SkuResults({ result, onOpenOrder }) {
  const { lines, sku, truncated } = result;
  const ordenes = new Set(lines.map((l) => l.orderNumber)).size;
  const conError = lines.filter((l) => String(l.hasError) === 'true').length;

  return (
    <section className="skures">
      <header className="bulk-results__head">
        <div>
          <h2>
            SKU <code>{sku}</code>
            <CopyButton value={sku} title="Copiar SKU" />
          </h2>
          <p>
            {lines.length} {lines.length === 1 ? 'línea' : 'líneas'} en {ordenes}{' '}
            {ordenes === 1 ? 'orden' : 'órdenes'}
            {conError > 0 ? ` · ${conError} con error` : ''} · da clic en una remisión para
            abrir su detalle
          </p>
        </div>
      </header>

      {truncated && (
        <div className="alert alert--info">
          <Info className="alert__icon" size={18} />
          <div>
            <strong>Resultado truncado.</strong> Se muestran las 500 líneas más recientes;
            acota el rango de fechas para ver el universo completo.
          </div>
        </div>
      )}

      <div className="skures__scroll">
        <table>
          <thead>
            <tr>
              <th>Remisión</th>
              <th>Compra</th>
              <th className="num">Cant.</th>
              <th>Tienda</th>
              <th>Destino</th>
              <th>Promesa</th>
              <th>Entrega</th>
              <th>Estatus</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const hasError = String(l.hasError) === 'true';
              return (
                <tr key={l.recordId || `${l.orderNumber}-${i}`}>
                  <td>
                    <button
                      type="button"
                      className="skures__link"
                      onClick={() => onOpenOrder(l.orderNumber)}
                      title="Abrir el detalle de esta orden"
                    >
                      {l.orderNumber}
                    </button>
                  </td>
                  <td>{fmtDateTime(l.createdAt)}</td>
                  <td className="num">{Number(l.quantity) || 1}</td>
                  <td>{l.origen ? `Tienda ${l.origen}` : 'MKTP'}</td>
                  <td>
                    {titleCase(l.destinationCity || '')} · CP {l.zipCode || '—'}
                  </td>
                  <td>
                    {l.edd1 ? (l.edd1 === l.edd2 ? fmtDate(l.edd1) : `${fmtDate(l.edd1)} → ${fmtDate(l.edd2)}`) : '—'}
                  </td>
                  <td>
                    <DeliveryBadge tipo={l.tipoEntrega} />
                  </td>
                  <td>
                    <span className={`badge ${hasError ? 'badge--noedd' : l.plan === 'B' ? 'badge--planb' : 'badge--plan'}`}>
                      {hasError ? (
                        <>
                          <AlertTriangle size={11} strokeWidth={2.4} />
                          Error {l.errorCode}
                        </>
                      ) : (
                        <>
                          <Check size={11} strokeWidth={2.8} />
                          Plan {l.plan || '—'}
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ─────────────────── vista principal ─────────────────── */

function OrderSearch() {
  const [mode, setMode] = useState('orden'); // 'orden' | 'sku'
  const [query, setQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { mode, found, lines, truncated, ... }
  const [recent, setRecent] = useState(loadRecent);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sanitize = (raw, m) =>
    m === 'orden'
      ? String(raw).replace(/[^A-Za-z0-9._-]/g, '') // remisiones sg…, KS…, UUIDs
      : String(raw).replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  const saveRecent = (m, q) => {
    const next = [{ m, q }, ...recent.filter((r) => !(r.m === m && r.q === q))].slice(0, 5);
    setRecent(next);
    try {
      sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* sin storage */
    }
  };

  const search = async (rawQ, rawMode) => {
    const m = rawMode ?? mode;
    const q = sanitize(rawQ ?? query, m);
    if (m === 'orden' && q.length < 6) {
      setError('Escribe una orden o remisión de al menos 6 caracteres.');
      setResult(null);
      return;
    }
    if (m === 'sku' && q.length < 4) {
      setError('Escribe un SKU de al menos 4 caracteres.');
      setResult(null);
      return;
    }
    if ((startDate === '') !== (endDate === '')) {
      setError('Completa ambas fechas del rango, o déjalas vacías para buscar en los últimos 6 meses.');
      return;
    }
    setMode(m);
    setQuery(q);
    setSearching(true);
    setError(null);
    setResult(null);
    try {
      const p = new URLSearchParams(m === 'orden' ? { orderNumber: q } : { sku: q });
      if (startDate && endDate) {
        p.set('start', startDate);
        p.set('end', nextDay(endDate)); // Hasta inclusivo
      }
      const res = await fetch(`/api/order-search?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult({ ...json, mode: m });
      if (json.found) saveRecent(m, q);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    search();
  };

  /** Desde la tabla de SKU: abrir el detalle de una orden */
  const openOrder = (num) => {
    setMode('orden');
    search(num, 'orden');
  };

  const header = result?.mode === 'orden' && result?.found ? result.lines[0] : null;

  const summary = useMemo(() => {
    if (result?.mode !== 'orden' || !result?.found) return null;
    const lines = result.lines;
    const piezas = lines.reduce((a, l) => a + (Number(l.quantity) || 1), 0);
    const tiendas = [...new Set(lines.map((l) => l.origen).filter(Boolean))];
    const conError = lines.filter((l) => String(l.hasError) === 'true').length;
    return { skus: lines.length, piezas, tiendas, conError };
  }, [result]);

  const rangoActivo = startDate && endDate;

  return (
    <div className="order-search">
      {/* ── Buscador ── */}
      <form className="search-hero" onSubmit={onSubmit} role="search">
        <label className="search-hero__label" htmlFor="order-search-input">
          {mode === 'orden' ? 'Buscar orden o remisión' : 'Buscar SKU'}
        </label>

        <div className="search-hero__modes" role="tablist" aria-label="Buscar por">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'orden'}
            className={`chip ${mode === 'orden' ? 'active' : ''}`}
            onClick={() => {
              setMode('orden');
              setQuery('');
              setResult(null);
              setError(null);
              inputRef.current?.focus();
            }}
          >
            <Hash size={12} />
            Por orden
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sku'}
            className={`chip ${mode === 'sku' ? 'active' : ''}`}
            onClick={() => {
              setMode('sku');
              setQuery('');
              setResult(null);
              setError(null);
              inputRef.current?.focus();
            }}
          >
            <Tag size={12} />
            Por SKU
          </button>
        </div>

        <div className="search-hero__bar">
          <Search className="search-hero__icon" size={19} strokeWidth={2.2} />
          <input
            id="order-search-input"
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck="false"
            placeholder={mode === 'orden' ? 'Ej. 6310116494 o sg2609080001809' : 'Ej. SB5014548396 o 5014548396'}
            value={query}
            onChange={(e) => setQuery(sanitize(e.target.value, mode))}
          />
          {query && (
            <button
              type="button"
              className="search-hero__clear"
              onClick={() => {
                setQuery('');
                setResult(null);
                setError(null);
                inputRef.current?.focus();
              }}
              aria-label="Limpiar búsqueda"
            >
              <X size={14} />
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={searching}>
            {searching ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Buscando…
              </>
            ) : (
              'Buscar'
            )}
          </button>
        </div>

        <div className="search-hero__dates">
          <DateRange
            startId="search-start"
            endId="search-end"
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
          />
          {rangoActivo && (
            <button
              type="button"
              className="chip search-hero__dates-clear"
              onClick={() => {
                setStartDate('');
                setEndDate('');
              }}
            >
              <X size={12} /> Quitar rango
            </button>
          )}
        </div>

        <p className="search-hero__hint">
          {rangoActivo
            ? 'Busca en el rango elegido (ambas fechas inclusive), todas las compañías del flujo Decomm.'
            : 'Sin rango: busca en los últimos 6 meses del flujo Decomm, todas las compañías.'}
          {mode === 'sku' ? ' El prefijo SB es opcional: se buscan ambas grafías.' : ''}
        </p>

        {recent.length > 0 && (
          <div className="search-hero__recent">
            <span className="search-hero__recent-label">
              <History size={12} /> Recientes
            </span>
            {recent.map((r) => (
              <button
                key={`${r.m}-${r.q}`}
                type="button"
                className="chip"
                onClick={() => search(r.q, r.m)}
              >
                {r.m === 'sku' ? <Tag size={11} /> : <Hash size={11} />}
                {r.q}
              </button>
            ))}
          </div>
        )}
      </form>

      {/* ── Estados ── */}
      {error && (
        <div className="alert alert--error" role="alert">
          <AlertTriangle className="alert__icon" size={18} />
          <div>
            <strong>No se pudo buscar.</strong> {error}
          </div>
        </div>
      )}

      {result && !result.found && (
        <div className="search-empty">
          <PackageSearch size={40} strokeWidth={1.6} />
          <h3>
            {result.mode === 'sku'
              ? `Sin líneas para el SKU ${result.sku}`
              : `No encontramos la orden ${result.orderNumber}`}
          </h3>
          <p>
            {rangoActivo
              ? 'Prueba ampliando el rango de fechas.'
              : 'La búsqueda cubre los últimos 6 meses de '}
            {!rangoActivo && <code>FAC_EDD_ORDERS_TRN</code>}
            {result.mode === 'sku' && !rangoActivo ? ' (con y sin prefijo SB).' : ''}
          </p>
        </div>
      )}

      {!result && !error && !searching && (
        <div className="search-empty search-empty--idle">
          <PackageSearch size={40} strokeWidth={1.6} />
          <h3>
            {mode === 'orden'
              ? 'Escribe un número de orden para empezar'
              : 'Escribe un SKU para empezar'}
          </h3>
          <p>
            {mode === 'orden'
              ? 'Verás sus SKUs, la tienda que asignó cada línea, las fechas estimadas y el tipo de entrega.'
              : 'Verás en qué órdenes aparece, cuándo se compró, la tienda asignada y su estatus — acota con el rango de fechas si el SKU es muy vendido.'}
          </p>
        </div>
      )}

      {/* ── Resultado por SKU ── */}
      {result?.mode === 'sku' && result.found && (
        <SkuResults result={result} onOpenOrder={openOrder} />
      )}

      {/* ── Resultado por orden ── */}
      {header && summary && (
        <article className="order-card">
          <header className="order-card__head">
            <div className="order-card__id">
              <span className="order-card__id-label">Orden</span>
              <h2 className="order-card__number">
                {header.orderNumber}
                <CopyButton value={header.orderNumber} title="Copiar número de orden" />
              </h2>
              <div className="order-card__meta">
                <span className={`badge ${header.company === 'LP' ? 'badge--lp' : 'badge--sb'}`}>
                  {header.company === 'LP' ? 'Liverpool' : header.company === 'SB' ? 'Suburbia' : header.company}
                </span>
                <span className="order-card__meta-item">
                  {header.channel === 'APP' ? <Smartphone size={13} /> : <Globe size={13} />}
                  {header.channel}
                </span>
                <span className="order-card__meta-item">
                  <CreditCard size={13} />
                  {header.paymentMethod === 'CREDIT_CARD' ? 'Tarjeta de crédito' : titleCase((header.paymentMethod || '').replace(/_/g, ' '))}
                </span>
                {String(header.marketPlace) === 'true' && (
                  <span className="badge badge--standard">Marketplace</span>
                )}
              </div>
            </div>

            <dl className="order-card__facts">
              <div>
                <dt>Compra</dt>
                <dd>{fmtDateTime(header.createdAt)}</dd>
              </div>
              <div>
                <dt>Destino</dt>
                <dd>
                  <MapPin size={12} />
                  {titleCase(header.destinationSuburb)}, {titleCase(header.destinationCity)} · CP {header.zipCode}
                </dd>
              </div>
              <div>
                <dt>Ticket EDD</dt>
                <dd className="order-card__ticket">
                  <code>{header.ticket ? `${header.ticket.slice(0, 8)}…` : '—'}</code>
                  {header.ticket && <CopyButton value={header.ticket} title="Copiar ticket completo" />}
                </dd>
              </div>
            </dl>
          </header>

          <div className="order-card__summary">
            <span className="order-card__stat">
              <Package size={13} strokeWidth={2.2} />
              <strong>{summary.skus}</strong> {summary.skus === 1 ? 'SKU' : 'SKUs'} ·{' '}
              <strong>{summary.piezas}</strong> {summary.piezas === 1 ? 'pieza' : 'piezas'}
            </span>
            <span className="order-card__stat">
              <Store size={13} strokeWidth={2.2} />
              {summary.tiendas.length === 0
                ? 'Sin tienda de origen'
                : summary.tiendas.length === 1
                ? `Surte la tienda ${summary.tiendas[0]}`
                : `${summary.tiendas.length} tiendas surten`}
            </span>
            {summary.tiendas.length > 1 && (
              <span className="badge badge--split">
                <Split size={11} strokeWidth={2.4} />
                Envío dividido
              </span>
            )}
            {summary.conError > 0 && (
              <span className="badge badge--noedd">
                <AlertTriangle size={11} strokeWidth={2.4} />
                {summary.conError} {summary.conError === 1 ? 'línea con error' : 'líneas con error'}
              </span>
            )}
          </div>

          <ul className="order-card__lines">
            {result.lines.map((line, i) => (
              <LineCard key={line.recordId || `${line.sku}-${i}`} line={line} index={i} />
            ))}
          </ul>
        </article>
      )}
    </div>
  );
}

export default OrderSearch;
