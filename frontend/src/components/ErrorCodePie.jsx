import { useMemo, useState } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Inbox, Info, Download, AlertCircle } from 'lucide-react';
import { getError, CATEGORY_ORDER } from '../errorCatalog.js';

ChartJS.register(ArcElement, Tooltip, Legend);

/** Más rebanadas que esto y la dona deja de leerse: la cola va a "Otros" */
const MAX_SLICES = 9;
const REST_COLOR = '#d8d8d8';

const fmtNum = (n) => n.toLocaleString('es-MX');
const fmtPct = (n) => `${n.toFixed(1).replace(/\.0$/, '')}%`;

/* Colores por categoría, para la vista agrupada */
const CATEGORY_COLOR = {
  Inventario: '#f97316',
  Capacidad: '#8b5cf6',
  Cobertura: '#37abc6',
  Operación: '#ec9e00',
  Motor: '#ff0000',
  'Sin clasificar': '#a1a1a1',
  'Sin error': '#09ac38',
};

/**
 * Dispara la descarga del CSV de un segmento.
 * Se usa fetch (y no window.open) para poder mostrar el spinner del renglón
 * y enseñar el mensaje del backend cuando el segmento no trae filas.
 */
async function downloadSegment(csvQuery, { codes, label }) {
  const params = new URLSearchParams(csvQuery);
  params.set('codes', codes ? codes.join(',') : 'all');
  params.set('label', label);

  const res = await fetch(`/api/error-codes-csv?${params}`);
  if (!res.ok) {
    throw new Error((await res.text()) || `HTTP ${res.status}`);
  }

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

function ErrorCodePie({ data, total, csvQuery }) {
  const [groupBy, setGroupBy] = useState('code'); // 'code' | 'category'
  const [downloading, setDownloading] = useState(null); // key del segmento en curso
  const [downloadError, setDownloadError] = useState(null);

  /* Enriquecemos con el catálogo una sola vez */
  const enriched = useMemo(
    () => (data || []).map((d) => ({ ...d, meta: getError(d.errorCode) })),
    [data]
  );

  /* Registros marcados como Error pero con código 0 (= EDD calculada):
     es una contradicción real del dato y conviene que se vea. */
  const zeroCode = useMemo(
    () => enriched.find((d) => d.meta.code === '0'),
    [enriched]
  );

  const slices = useMemo(() => {
    if (enriched.length === 0) return [];

    if (groupBy === 'category') {
      const acc = new Map();
      for (const d of enriched) {
        const key = d.meta.category;
        const prev = acc.get(key) || { key, total: 0, codes: [] };
        prev.total += d.total;
        if (!prev.codes.includes(d.meta.code)) prev.codes.push(d.meta.code);
        acc.set(key, prev);
      }
      return [...acc.values()]
        .sort(
          (a, b) =>
            b.total - a.total ||
            CATEGORY_ORDER.indexOf(a.key) - CATEGORY_ORDER.indexOf(b.key)
        )
        .map((c) => ({
          key: c.key,
          label: c.key,
          sub: `Códigos ${c.codes.join(', ')}`,
          total: c.total,
          color: CATEGORY_COLOR[c.key] || '#a1a1a1',
          codes: c.codes,
        }));
    }

    const sorted = [...enriched].sort((a, b) => b.total - a.total);
    const toSlice = (d) => ({
      key: d.meta.code,
      label: d.meta.code === 'SIN CÓDIGO' ? d.meta.label : `${d.meta.code} · ${d.meta.label}`,
      sub: d.meta.desc,
      total: d.total,
      color: d.meta.color,
      codes: [d.meta.code],
    });

    if (sorted.length <= MAX_SLICES) return sorted.map(toSlice);

    const tail = sorted.slice(MAX_SLICES - 1);
    return [
      ...sorted.slice(0, MAX_SLICES - 1).map(toSlice),
      {
        key: '__otros__',
        label: `Otros (${tail.length} códigos)`,
        sub: tail.map((t) => t.meta.code).join(', '),
        total: tail.reduce((a, t) => a + t.total, 0),
        color: REST_COLOR,
        codes: tail.map((t) => t.meta.code),
      },
    ];
  }, [enriched, groupBy]);

  /* Una descarga a la vez: son consultas a BigQuery, no archivos estáticos */
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

  if (slices.length === 0 || total === 0) {
    return (
      <div className="errorpie__empty">
        <Inbox size={30} strokeWidth={1.6} />
        <p>Sin registros clasificados como Error en este rango.</p>
      </div>
    );
  }

  const root = getComputedStyle(document.documentElement);
  const surface = root.getPropertyValue('--surface').trim() || '#ffffff';
  const fontFamily = root.getPropertyValue('--font-sans').trim() || 'Roboto, sans-serif';

  const chartData = {
    labels: slices.map((s) => s.label),
    datasets: [
      {
        data: slices.map((s) => s.total),
        backgroundColor: slices.map((s) => s.color),
        borderColor: surface,
        borderWidth: 2,
        hoverOffset: 8,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '58%',
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false }, // leyenda propia, con cifras exactas
      tooltip: {
        backgroundColor: 'rgba(10, 22, 40, 0.96)',
        padding: 12,
        cornerRadius: 8,
        titleFont: { family: fontFamily, size: 12, weight: '600' },
        bodyFont: { family: fontFamily, size: 12 },
        boxPadding: 6,
        usePointStyle: true,
        callbacks: {
          label: (ctx) =>
            `  ${fmtPct((ctx.parsed / total) * 100)}  ·  ${fmtNum(ctx.parsed)} registros`,
          afterLabel: (ctx) => {
            const sub = slices[ctx.dataIndex]?.sub;
            if (!sub) return '';
            // Chart.js no hace wrap: partimos a ~46 caracteres por línea
            return sub.replace(/(.{1,46})(\s|$)/g, '  $1\n').trimEnd();
          },
        },
      },
    },
  };

  const top = slices[0];

  return (
    <div className="errorpie">
      <div className="errorpie__toolbar">
        <button
          type="button"
          className={`chip ${groupBy === 'code' ? 'active' : ''}`}
          onClick={() => setGroupBy('code')}
        >
          Por código
        </button>
        <button
          type="button"
          className={`chip ${groupBy === 'category' ? 'active' : ''}`}
          onClick={() => setGroupBy('category')}
        >
          Por categoría
        </button>
        {csvQuery && (
          <button
            type="button"
            className="chip"
            onClick={() =>
              handleDownload('__todos__', { codes: null, label: 'todos los errores' })
            }
            disabled={Boolean(downloading)}
            title={`Descargar en CSV los ${fmtNum(total)} registros con Error del rango`}
          >
            {downloading === '__todos__' ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <Download size={12} />
            )}
            Descargar todo
          </button>
        )}
      </div>

      <div className="errorpie__chart">
        <Doughnut data={chartData} options={options} />
        <div className="errorpie__center">
          <strong>{fmtNum(total)}</strong>
          <span>registros con Error</span>
        </div>
      </div>

      <ul className="errorpie__legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="errorpie__swatch" style={{ background: s.color }} />
            <span className="errorpie__code" title={s.sub || s.label}>
              {s.label}
            </span>
            <span className="errorpie__pct">{fmtPct((s.total / total) * 100)}</span>
            <span className="errorpie__abs">{fmtNum(s.total)}</span>
            {csvQuery && (
              <button
                type="button"
                className="errorpie__dl"
                onClick={() => handleDownload(s.key, { codes: s.codes, label: s.label })}
                disabled={Boolean(downloading)}
                aria-label={`Descargar los ${fmtNum(s.total)} registros de ${s.label}`}
                title={`Descargar CSV · ${fmtNum(s.total)} registros de ${s.label}`}
              >
                {downloading === s.key ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Download size={13} strokeWidth={2.2} />
                )}
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="errorpie__notes">
        {downloadError && (
          <p className="errorpie__dlerror" role="alert">
            <AlertCircle size={14} strokeWidth={2.2} />
            <span>{downloadError}</span>
          </p>
        )}

        <p className="errorpie__insight">
          <strong>{top.label}</strong> concentra el{' '}
          <strong>{fmtPct((top.total / total) * 100)}</strong> de los errores del rango
          {top.sub && groupBy === 'code' ? ` — ${top.sub}` : ''}.
        </p>

        {zeroCode && (
          <p className="errorpie__warn">
            <Info size={14} strokeWidth={2.2} />
            <span>
              {fmtNum(zeroCode.total)} registros traen <code>errorCode 0</code> (EDD
              calculada) pero la vista los clasifica como Error: el plan no es A ni B, o
              falta <code>edd1</code>/<code>edd2</code>. Vale la pena revisarlos aparte.
              {csvQuery && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="errorpie__dllink"
                    onClick={() =>
                      handleDownload('__cero__', { codes: ['0'], label: 'errorCode-0' })
                    }
                    disabled={Boolean(downloading)}
                  >
                    {downloading === '__cero__' ? 'Descargando…' : 'Descargarlos en CSV'}
                  </button>
                </>
              )}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

export default ErrorCodePie;
