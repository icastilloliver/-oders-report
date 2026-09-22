import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Inbox } from 'lucide-react';
import { getError } from '../errorCatalog.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

/* ─────────────────── % Error diario por causal ───────────────────
 * La misma barra diaria de la vista, pero solo el segmento de Error, abierto
 * por causal: la altura de cada barra es el % Error del día (sobre todas las
 * líneas) y sus segmentos son los errorCode con los colores del catálogo —
 * el mismo código se ve igual aquí, en la dona y en la tendencia. */

const MAX_SERIES = 4; // más causales se pliegan en «Otros»
const REST_COLOR = '#cbd5e1';

const monthAbbr = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtNum = (n) => n.toLocaleString('es-MX');
const fmtPct = (n) => `${n.toFixed(2).replace(/\.?0+$/, '')}%`;
const fmtDia = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${monthAbbr[parseInt(m, 10) - 1]} ${y}`;
};

function ErrorDailyStack({ days, codes }) {
  /* Pivote: top causales del rango + «Otros», alineados a los días */
  const { series } = useMemo(() => {
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
    return { series };
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
  const surface = root.getPropertyValue('--surface').trim() || '#ffffff';
  const text3 = root.getPropertyValue('--text-3').trim() || '#6b7280';
  const border = root.getPropertyValue('--border').trim() || '#ebebeb';
  const fontFamily = root.getPropertyValue('--font-sans').trim() || 'Roboto, sans-serif';

  const labels = days.map((d) => fmtDia(d.Fecha));
  const dayTotals = days.map((d) => d.total);
  const pctOf = (n, i) => (dayTotals[i] ? (n / dayTotals[i]) * 100 : 0);

  const chartData = {
    labels,
    datasets: series.map((s, i) => ({
      label: s.label,
      data: s.abs.map(pctOf),
      absolute: s.abs,
      backgroundColor: s.color,
      // Separador de 2px color superficie entre segmentos apilados
      borderColor: surface,
      borderWidth: { top: 2 },
      borderSkipped: false,
      borderRadius: i === series.length - 1 ? { topLeft: 4, topRight: 4 } : 0,
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
          pointStyle: 'circle',
          padding: 18,
          font: { family: fontFamily, size: 12, weight: '600' },
          color: text3,
          boxWidth: 8,
          boxHeight: 8,
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
        stacked: true,
        grid: { display: false },
        border: { color: border },
        ticks: {
          font: { family: fontFamily, size: 10, weight: '500' },
          color: text3,
          maxRotation: 45,
          minRotation: days.length > 10 ? 45 : 0,
        },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: { color: border, drawTicks: false },
        border: { display: false },
        ticks: {
          font: { family: fontFamily, size: 11 },
          color: text3,
          padding: 8,
          callback: (v) => `${v}%`,
        },
      },
    },
  };

  return (
    <div className="chart-wrapper">
      <Bar data={chartData} options={options} />
    </div>
  );
}

export default ErrorDailyStack;
