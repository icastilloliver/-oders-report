import { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Inbox, Table2 } from 'lucide-react';
import { getError } from '../errorCatalog.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

/* ─────────────────── Comportamiento diario de los errores ───────────────────
 * Línea por causal (top 5 + «Otros») con los colores fijos del catálogo: el
 * mismo código se ve igual aquí, en la dona y en la tabla por surtido. Dos
 * lecturas: registros absolutos por día, o % sobre las líneas del día (la
 * contribución de cada causal a la tasa de error, comparable entre días de
 * distinto volumen). Tooltip de columna completa: un solo hover lista todas
 * las series de ese día, y la tabla desplegable es la gemela accesible. */

const MAX_SERIES = 5; // más allá, la cola se pliega en «Otros»
const REST_COLOR = '#cbd5e1';

const monthAbbr = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtNum = (n) => n.toLocaleString('es-MX');
const fmtPct = (n) => `${n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/, '')}%`;
const fmtDia = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${monthAbbr[parseInt(m, 10) - 1]} ${y}`;
};

function ErrorTrendChart({ days, codes }) {
  const [mode, setMode] = useState('abs'); // 'abs' registros | 'pct' % del día
  const [showTable, setShowTable] = useState(false);

  /* Pivote: top MAX_SERIES causales por volumen del rango + «Otros» */
  const { fechas, series, peak } = useMemo(() => {
    const fechas = days.map((d) => d.Fecha);
    const idx = new Map(fechas.map((f, i) => [f, i]));
    const totalPorCodigo = new Map();
    for (const r of codes) {
      totalPorCodigo.set(r.errorCode, (totalPorCodigo.get(r.errorCode) || 0) + r.total);
    }
    const orden = [...totalPorCodigo.entries()].sort((a, b) => b[1] - a[1]);
    const top = orden.length <= MAX_SERIES + 1 ? orden : orden.slice(0, MAX_SERIES);
    const topSet = new Set(top.map(([c]) => c));
    const foldeados = orden.filter(([c]) => !topSet.has(c));

    const mk = () => new Array(fechas.length).fill(0);
    const porCodigo = new Map(top.map(([c]) => [c, mk()]));
    const otros = mk();
    for (const r of codes) {
      const i = idx.get(r.Fecha);
      if (i === undefined) continue;
      if (topSet.has(r.errorCode)) porCodigo.get(r.errorCode)[i] += r.total;
      else otros[i] += r.total;
    }

    const series = top.map(([code]) => {
      const meta = getError(code);
      return {
        key: meta.code,
        label: meta.code === 'SIN CÓDIGO' ? meta.label : `${meta.code} · ${meta.label}`,
        color: meta.color,
        abs: porCodigo.get(code),
      };
    });
    if (foldeados.length > 0) {
      series.push({
        key: '__otros__',
        label: `Otros (${foldeados.length} códigos)`,
        color: REST_COLOR,
        abs: otros,
      });
    }

    const peak = days.reduce((max, d) => (d.errores > (max?.errores ?? -1) ? d : max), null);
    return { fechas, series, peak };
  }, [days, codes]);

  if (days.length === 0 || series.length === 0) {
    return (
      <div className="errorpie__empty">
        <Inbox size={30} strokeWidth={1.6} />
        <p>Sin registros clasificados como Error en este rango.</p>
      </div>
    );
  }

  const root = getComputedStyle(document.documentElement);
  const text3 = root.getPropertyValue('--text-3').trim() || '#6b7280';
  const borderColor = root.getPropertyValue('--border').trim() || '#e6e8eb';
  const surface = root.getPropertyValue('--surface').trim() || '#ffffff';
  const fontFamily =
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  const dayTotals = days.map((d) => d.total);
  const valores = (s) =>
    mode === 'abs' ? s.abs : s.abs.map((n, i) => (dayTotals[i] ? (n / dayTotals[i]) * 100 : 0));

  const chartData = {
    labels: fechas.map(fmtDia),
    datasets: series.map((s) => ({
      label: s.label,
      data: valores(s),
      absolute: s.abs,
      borderColor: s.color,
      backgroundColor: s.color,
      borderWidth: 2,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5,
      pointHitRadius: 14,
      pointBorderColor: surface,
      pointBorderWidth: 1.5,
      borderDash: s.key === '__otros__' ? [5, 4] : undefined,
    })),
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        labels: {
          usePointStyle: true,
          pointStyle: 'line',
          padding: 18,
          font: { family: fontFamily, size: 12, weight: '600' },
          color: text3,
          boxWidth: 18,
          boxHeight: 2,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(10, 22, 40, 0.96)',
        padding: 12,
        cornerRadius: 8,
        titleFont: { family: fontFamily, size: 12, weight: '600' },
        bodyFont: { family: fontFamily, size: 12 },
        bodySpacing: 6,
        boxPadding: 6,
        usePointStyle: true,
        itemSort: (a, b) => b.parsed.y - a.parsed.y,
        callbacks: {
          label: (ctx) => {
            const abs = ctx.dataset.absolute[ctx.dataIndex];
            if (mode === 'abs') return `  ${ctx.dataset.label}: ${fmtNum(abs)}`;
            return `  ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y)}  ·  ${fmtNum(abs)}`;
          },
          footer: (items) => {
            const i = items[0]?.dataIndex;
            if (i === undefined) return '';
            const d = days[i];
            return `Día: ${fmtNum(d.errores)} errores de ${fmtNum(d.total)} líneas (${fmtPct(
              d.total ? (d.errores / d.total) * 100 : 0
            )})`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: borderColor },
        ticks: {
          font: { family: fontFamily, size: 10, weight: '500' },
          color: text3,
          maxRotation: 45,
          minRotation: fechas.length > 10 ? 45 : 0,
        },
      },
      y: {
        beginAtZero: true,
        grid: { color: borderColor, drawTicks: false },
        border: { display: false },
        ticks: {
          font: { family: fontFamily, size: 11 },
          color: text3,
          padding: 8,
          precision: mode === 'abs' ? 0 : undefined,
          callback: (v) => (mode === 'abs' ? fmtNum(v) : `${v}%`),
        },
      },
    },
  };

  return (
    <div className="etrend">
      <div className="etrend__toolbar">
        <button
          type="button"
          className={`chip ${mode === 'abs' ? 'active' : ''}`}
          onClick={() => setMode('abs')}
        >
          Registros por día
        </button>
        <button
          type="button"
          className={`chip ${mode === 'pct' ? 'active' : ''}`}
          onClick={() => setMode('pct')}
          title="Cada causal como porcentaje de las líneas totales del día: la suma de las series es el % Error diario"
        >
          % de las líneas del día
        </button>
        <button
          type="button"
          className={`chip ${showTable ? 'active' : ''}`}
          onClick={() => setShowTable((v) => !v)}
        >
          <Table2 size={12} /> Ver tabla
        </button>
      </div>

      <div className="chart-wrapper">
        <Line data={chartData} options={options} />
      </div>

      {peak && (
        <p className="etrend__insight">
          Pico del rango: <strong>{fmtNum(peak.errores)} errores</strong> el{' '}
          <strong>{fmtDia(peak.Fecha)}</strong> (
          {fmtPct(peak.total ? (peak.errores / peak.total) * 100 : 0)} de las{' '}
          {fmtNum(peak.total)} líneas de ese día).
        </p>
      )}

      {showTable && (
        <div className="etrend__table">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                {series.map((s) => (
                  <th key={s.key} className="num">
                    <span className="bulk-codes__dot" style={{ background: s.color }} />
                    {s.key === '__otros__' ? 'Otros' : s.key}
                  </th>
                ))}
                <th className="num">Errores</th>
                <th className="num">Líneas</th>
                <th className="num">% Error</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d.Fecha}>
                  <td>{fmtDia(d.Fecha)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="num">
                      {s.abs[i] ? fmtNum(s.abs[i]) : '—'}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{fmtNum(d.errores)}</strong>
                  </td>
                  <td className="num">{fmtNum(d.total)}</td>
                  <td className="num">{fmtPct(d.total ? (d.errores / d.total) * 100 : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ErrorTrendChart;
