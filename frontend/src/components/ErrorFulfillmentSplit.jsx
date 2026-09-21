import { useMemo, useState } from 'react';
import { Home, Store, Download, Inbox, AlertCircle, Info } from 'lucide-react';
import { getError } from '../errorCatalog.js';

/* ─────────────────── Error por tipo de surtido (LP Decomm) ───────────────────
 * Dos lecturas en una: (1) qué tan grande es el % Error DENTRO de cada tipo de
 * surtido — domicilio vs Click & Collect — y (2) qué causales lo componen en
 * cada segmento, lado a lado. La identidad del causal la dan el punto de color
 * del catálogo + código + etiqueta (nunca solo el color), y cada celda lleva
 * su cifra exacta: las barras solo ayudan a comparar de un vistazo. */

const SEGMENTS = [
  {
    key: 'domicilio',
    label: 'Entrega a domicilio',
    icon: Home,
    fulfillmentType: 'Fulfillment_Type_Liverpool',
  },
  {
    key: 'cnc',
    label: 'Click & Collect (tienda)',
    icon: Store,
    fulfillmentType: 'Liverpool_CNC_PICK_PACK',
  },
];

const fmtNum = (n) => n.toLocaleString('es-MX');
const fmtPct = (n) => `${n.toFixed(1).replace(/\.0$/, '')}%`;
const rate = (part, total) => (total > 0 ? (part / total) * 100 : 0);

/** Descarga el CSV de un causal acotado a un tipo de surtido */
async function downloadSegment(csvQuery, { fulfillmentType, codes, label }) {
  const params = new URLSearchParams(csvQuery);
  if (fulfillmentType) params.set('fulfillmentType', fulfillmentType);
  params.set('codes', codes ? codes.join(',') : 'all');
  params.set('label', label);
  const res = await fetch(`/api/error-codes-csv?${params}`);
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : 'errores.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ErrorFulfillmentSplit({ data, csvQuery }) {
  const [downloading, setDownloading] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  const segs = useMemo(
    () =>
      SEGMENTS.map((s) => {
        const raw = data?.[s.key] || { total: 0, errores: 0, codes: [] };
        return { ...s, ...raw, tasa: rate(raw.errores, raw.total) };
      }),
    [data]
  );

  const peor = useMemo(
    () =>
      segs.reduce(
        (max, s) => (s.total > 0 && s.tasa > (max?.tasa ?? -1) ? s : max),
        null
      ),
    [segs]
  );

  /* Unión de causales: una fila por errorCode, con la cifra de cada segmento */
  const rows = useMemo(() => {
    const acc = new Map();
    for (const s of segs) {
      for (const c of s.codes) {
        const meta = getError(c.errorCode);
        const prev = acc.get(meta.code) || { meta, porSeg: {}, combinado: 0 };
        prev.porSeg[s.key] = (prev.porSeg[s.key] || 0) + c.total;
        prev.combinado += c.total;
        acc.set(meta.code, prev);
      }
    }
    return [...acc.values()].sort((a, b) => b.combinado - a.combinado);
  }, [segs]);

  const otro = data?.otro || { total: 0, errores: 0 };

  const handleDownload = async (key, segment) => {
    if (!csvQuery || downloading) return;
    setDownloading(key);
    setDownloadError(null);
    try {
      await downloadSegment(csvQuery, segment);
    } catch (err) {
      setDownloadError(`No se pudo descargar «${segment.label}»: ${err.message}`);
    } finally {
      setDownloading(null);
    }
  };

  if (segs.every((s) => s.total === 0)) {
    return (
      <div className="errorpie__empty">
        <Inbox size={30} strokeWidth={1.6} />
        <p>Sin líneas de domicilio ni Click &amp; Collect en este rango.</p>
      </div>
    );
  }

  return (
    <div className="fsplit">
      {/* ── Tasa de error por segmento ── */}
      <div className="bulk-stats fsplit__tiles">
        {segs.map((s) => {
          const Icon = s.icon;
          const esPeor = peor && peor.key === s.key && segs.every((x) => x.total > 0);
          const top = s.codes[0] ? getError(s.codes[0].errorCode) : null;
          return (
            <div key={s.key} className={`bulk-stat ${esPeor ? 'bulk-stat--danger' : 'bulk-stat--neutral'}`}>
              <div className="bulk-stat__head">
                <Icon size={15} strokeWidth={2.2} />
                <span>
                  {s.label}
                  {esPeor ? ' · el más afectado' : ''}
                </span>
              </div>
              <strong className="bulk-stat__value">{fmtPct(s.tasa)} Error</strong>
              <span className="bulk-stat__sub">
                {fmtNum(s.errores)} de {fmtNum(s.total)} líneas
                {top ? ` · causal principal: ${top.code} · ${top.label}` : ' · sin errores'}
              </span>
              <div className="bulk-stat__bar" role="presentation">
                <span style={{ width: `${Math.min(100, s.tasa)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {downloadError && (
        <p className="errorpie__dlerror" role="alert">
          <AlertCircle size={14} strokeWidth={2.2} />
          <span>{downloadError}</span>
        </p>
      )}

      {/* ── Causales lado a lado ── */}
      {rows.length > 0 && (
        <section className="bulk-codes fsplit__table">
          <h3>
            Causales por segmento <span>(% dentro del Error de cada surtido)</span>
          </h3>
          <table>
            <thead>
              <tr>
                <th>Causal</th>
                <th>Categoría</th>
                {segs.map((s) => {
                  const Icon = s.icon;
                  return (
                    <th key={s.key} colSpan={2} className="fsplit__seghead">
                      <Icon size={12} strokeWidth={2.2} /> {s.key === 'cnc' ? 'Click & Collect' : 'Domicilio'}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ meta, porSeg }) => (
                <tr key={meta.code}>
                  <td>
                    <span className="bulk-codes__dot" style={{ background: meta.color }} />
                    <code>{meta.code}</code>{' '}
                    <strong className="bulk-codes__label">{meta.label}</strong>
                    <span className="bulk-codes__desc">{meta.desc}</span>
                  </td>
                  <td>
                    <span className="chip chip--static">{meta.category}</span>
                  </td>
                  {segs.map((s) => {
                    const n = porSeg[s.key] || 0;
                    const share = rate(n, s.errores);
                    const dlKey = `${meta.code}·${s.key}`;
                    return (
                      <FragmentCells
                        key={s.key}
                        n={n}
                        share={share}
                        color={meta.color}
                        onDownload={
                          n > 0
                            ? () =>
                                handleDownload(dlKey, {
                                  fulfillmentType: s.fulfillmentType,
                                  codes: [meta.code],
                                  label: `${meta.code}-${s.key}`,
                                })
                            : null
                        }
                        downloading={downloading === dlKey}
                        anyDownloading={Boolean(downloading)}
                        aria={`Descargar los ${fmtNum(n)} registros del código ${meta.code} en ${s.label}`}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {otro.total > 0 && (
        <p className="fsplit__note">
          <Info size={13} strokeWidth={2.2} />
          <span>
            {fmtNum(otro.total)} líneas del rango traen otro tipo de surtido (
            {fmtNum(otro.errores)} con Error) y quedan fuera de esta comparativa; la dona de
            arriba sí las incluye.
          </span>
        </p>
      )}
    </div>
  );
}

/** Celdas de un segmento: cifra exacta + barra de % con descarga del causal */
function FragmentCells({ n, share, color, onDownload, downloading, anyDownloading, aria }) {
  return (
    <>
      <td className="fsplit__num">
        {n > 0 ? (
          <>
            {fmtNum(n)} <span className="fsplit__pct">· {fmtPct(share)}</span>
          </>
        ) : (
          <span className="fsplit__vacio">—</span>
        )}
      </td>
      <td className="fsplit__barcell">
        <div className="bulk-codes__bar">
          <span style={{ width: `${share}%`, background: color }} />
        </div>
        {onDownload && (
          <button
            type="button"
            className="errorpie__dl"
            onClick={onDownload}
            disabled={anyDownloading}
            aria-label={aria}
            title={aria}
          >
            {downloading ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <Download size={13} strokeWidth={2.2} />
            )}
          </button>
        )}
      </td>
    </>
  );
}

export default ErrorFulfillmentSplit;
