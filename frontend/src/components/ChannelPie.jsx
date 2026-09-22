import { useMemo, useState } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Inbox } from 'lucide-react';

ChartJS.register(ArcElement, Tooltip, Legend);

/* ─────────────────── % por canal ───────────────────
 * Dos lecturas de pastel sobre el mismo universo filtrado:
 *   · Líneas   — reparto de TODAS las líneas del rango por canal.
 *   · Con Error — reparto de los ERRORES por canal (qué % del Error aporta
 *     cada canal). La TASA de error de cada canal (errores/líneas del canal)
 *     no es parte-de-un-todo, así que nunca se grafica como rebanada: va en
 *     la leyenda y el tooltip como cifra.
 * El color es FIJO por canal (no por ranking): APP siempre se ve igual. */

const CHANNEL_META = {
  APP: { color: '#3b82f6', desc: 'Aplicación móvil' },
  WEB: { color: '#8b5cf6', desc: 'Sitio web escritorio' },
  WAP: { color: '#14b8a6', desc: 'Web móvil' },
  CSC: { color: '#f59e0b', desc: 'Centro de servicio a clientes' },
  'SIN CANAL': { color: '#94a3b8', desc: 'Registros sin canal informado' },
};

/* Canales no catalogados: color estable derivado del nombre */
const FALLBACK_COLORS = ['#0ea5e9', '#65a30d', '#c026d3', '#0f766e', '#a16207'];

const channelMeta = (name) => {
  if (CHANNEL_META[name]) return CHANNEL_META[name];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return { color: FALLBACK_COLORS[hash % FALLBACK_COLORS.length], desc: 'Canal no catalogado' };
};

const fmtNum = (n) => n.toLocaleString('es-MX');
const fmtPct = (n) => `${n.toFixed(1).replace(/\.0$/, '')}%`;

function ChannelPie({ data, total }) {
  const [mode, setMode] = useState('lineas'); // 'lineas' | 'errores'

  const slices = useMemo(() => {
    const base = (data || []).map((d) => ({
      ...d,
      meta: channelMeta(d.channel),
      tasaError: d.total ? (d.errores / d.total) * 100 : 0,
    }));
    if (mode === 'lineas') return base;
    // En modo errores, el orden y las rebanadas son por errores del canal
    return base
      .filter((d) => d.errores > 0)
      .sort((a, b) => b.errores - a.errores);
  }, [data, mode]);

  const totalErrores = useMemo(
    () => (data || []).reduce((a, d) => a + d.errores, 0),
    [data]
  );

  const whole = mode === 'lineas' ? total : totalErrores;
  const valueOf = (s) => (mode === 'lineas' ? s.total : s.errores);

  if (slices.length === 0 || whole === 0) {
    return (
      <div className="errorpie">
        <div className="errorpie__toolbar">
          <ModeChips mode={mode} setMode={setMode} />
        </div>
        <div className="errorpie__empty">
          <Inbox size={30} strokeWidth={1.6} />
          <p>
            {mode === 'errores'
              ? 'Sin registros con Error para este rango y filtros.'
              : 'Sin registros para este rango y filtros.'}
          </p>
        </div>
      </div>
    );
  }

  const root = getComputedStyle(document.documentElement);
  const surface = root.getPropertyValue('--surface').trim() || '#ffffff';
  const fontFamily = root.getPropertyValue('--font-sans').trim() || 'Roboto, sans-serif';

  const chartData = {
    labels: slices.map((s) => s.channel),
    datasets: [
      {
        data: slices.map(valueOf),
        backgroundColor: slices.map((s) => s.meta.color),
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
            `  ${fmtPct((ctx.parsed / whole) * 100)}  ·  ${fmtNum(ctx.parsed)} ${
              mode === 'lineas' ? 'líneas' : 'errores'
            }`,
          afterLabel: (ctx) => {
            const s = slices[ctx.dataIndex];
            if (!s) return '';
            return mode === 'lineas'
              ? `  ${fmtNum(s.errores)} con Error (${fmtPct(s.tasaError)} del canal)`
              : `  de ${fmtNum(s.total)} líneas del canal (tasa ${fmtPct(s.tasaError)})`;
          },
        },
      },
    },
  };

  const top = slices[0];

  return (
    <div className="errorpie">
      <div className="errorpie__toolbar">
        <ModeChips mode={mode} setMode={setMode} />
      </div>

      <div className="errorpie__chart">
        <Doughnut data={chartData} options={options} />
        <div className="errorpie__center">
          <strong>{fmtNum(whole)}</strong>
          <span>{mode === 'lineas' ? 'líneas en el rango' : 'errores en el rango'}</span>
        </div>
      </div>

      <ul className="errorpie__legend">
        {slices.map((s) => (
          <li key={s.channel}>
            <span className="errorpie__swatch" style={{ background: s.meta.color }} />
            <span className="errorpie__code" title={s.meta.desc}>
              {s.channel}
              {mode === 'errores' && (
                <em className="channelpie__tasa"> · tasa {fmtPct(s.tasaError)}</em>
              )}
            </span>
            <span className="errorpie__pct">{fmtPct((valueOf(s) / whole) * 100)}</span>
            <span className="errorpie__abs">{fmtNum(valueOf(s))}</span>
          </li>
        ))}
      </ul>

      <div className="errorpie__notes">
        <p className="errorpie__insight">
          {mode === 'lineas' ? (
            <>
              <strong>{top.channel}</strong> concentra el{' '}
              <strong>{fmtPct((top.total / total) * 100)}</strong> de las líneas del rango, con{' '}
              {fmtPct(top.tasaError)} de error dentro del canal.
            </>
          ) : (
            <>
              <strong>{top.channel}</strong> aporta el{' '}
              <strong>{fmtPct((top.errores / totalErrores) * 100)}</strong> de los errores del
              rango — {fmtNum(top.errores)} de sus {fmtNum(top.total)} líneas fallaron (tasa{' '}
              {fmtPct(top.tasaError)}).
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** Chips del modo del pastel: universo completo vs solo errores */
function ModeChips({ mode, setMode }) {
  return (
    <>
      <button
        type="button"
        className={`chip ${mode === 'lineas' ? 'active' : ''}`}
        onClick={() => setMode('lineas')}
        title="Reparto de todas las líneas del rango por canal"
      >
        Líneas
      </button>
      <button
        type="button"
        className={`chip ${mode === 'errores' ? 'active' : ''}`}
        onClick={() => setMode('errores')}
        title="Qué % de los errores del rango aporta cada canal"
      >
        Con Error
      </button>
    </>
  );
}

export default ChannelPie;
