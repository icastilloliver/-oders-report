import { useMemo } from 'react';
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
import { Inbox } from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

/* ─────────────────── Timeline del día por hora ───────────────────
 * Aparece al filtrar UN solo día: % de Error y de Plan B sobre las líneas
 * de cada hora (CDMX). Son tasas por hora — no partes de un todo — así que
 * la forma correcta son líneas, no barras apiladas; el volumen de cada hora
 * vive en el tooltip para no caer en un doble eje. Horas sin tráfico se
 * dibujan como hueco (null), no como 0% engañoso. */

const fmtNum = (n) => n.toLocaleString('es-MX');
const fmtPct = (n) => `${n.toFixed(2).replace(/\.?0+$/, '')}%`;
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

function HourlyTimeline({ data, rangoDeUnDia = true }) {
  const { labels, errorPct, planBPct, peak, totalDia } = useMemo(() => {
    const labels = data.map((b) => hourLabel(b.Hora));
    const rate = (part, total) => (total > 0 ? (part / total) * 100 : null);
    const errorPct = data.map((b) => rate(b.Error, b.Total));
    const planBPct = data.map((b) => rate(b.Plan_B, b.Total));
    const totalDia = data.reduce((a, b) => a + b.Total, 0);
    // Peor hora por % Error, ignorando horas con volumen marginal (<1% del
    // día): 2 errores de 3 líneas a las 4 am no son "la peor hora".
    const piso = Math.max(1, totalDia * 0.01);
    const candidatas = data.filter((b) => b.Total >= piso && b.Error > 0);
    const pool = candidatas.length > 0 ? candidatas : data.filter((b) => b.Error > 0);
    const peak = pool.length > 0
      ? pool.reduce((max, b) => (b.Error / b.Total > max.Error / max.Total ? b : max))
      : null;
    return { labels, errorPct, planBPct, peak, totalDia };
  }, [data]);

  if (totalDia === 0) {
    return (
      <div className="errorpie__empty">
        <Inbox size={30} strokeWidth={1.6} />
        <p>Sin líneas para este día con los filtros activos.</p>
      </div>
    );
  }

  const root = getComputedStyle(document.documentElement);
  const errorColor = root.getPropertyValue('--error').trim() || '#ff3333';
  const planBColor = root.getPropertyValue('--plan-b').trim() || '#f0b133';
  const surface = root.getPropertyValue('--surface').trim() || '#ffffff';
  const text3 = root.getPropertyValue('--text-3').trim() || '#767676';
  const border = root.getPropertyValue('--border').trim() || '#ebebeb';
  const fontFamily = root.getPropertyValue('--font-sans').trim() || 'Roboto, sans-serif';

  const mkSeries = (label, values, color) => ({
    label,
    data: values,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    tension: 0.3,
    spanGaps: false, // hora sin tráfico = hueco honesto, no 0%
    pointRadius: 3,
    pointHoverRadius: 5,
    pointHitRadius: 14,
    pointBorderColor: surface,
    pointBorderWidth: 1.5,
  });

  const chartData = {
    labels,
    datasets: [
      mkSeries('% Error', errorPct, errorColor),
      mkSeries('% Plan B', planBPct, planBColor),
    ],
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
        callbacks: {
          label: (ctx) => {
            const b = data[ctx.dataIndex];
            const abs = ctx.dataset.label === '% Error' ? b.Error : b.Plan_B;
            if (ctx.parsed.y === null) return `  ${ctx.dataset.label}: sin tráfico`;
            return `  ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y)}  ·  ${fmtNum(abs)}`;
          },
          footer: (items) => {
            const b = data[items[0]?.dataIndex];
            if (!b) return '';
            return `Hora: ${fmtNum(b.Total)} líneas · Plan A ${fmtNum(b.PlanA ?? b.Plan_A)}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: border },
        ticks: {
          font: { family: fontFamily, size: 10, weight: '500' },
          color: text3,
          maxRotation: 0,
          autoSkipPadding: 12,
        },
      },
      y: {
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
    <div className="hourlytl">
      <div className="chart-wrapper">
        <Line data={chartData} options={options} />
      </div>
      {peak && (
        <p className="etrend__insight">
          {rangoDeUnDia ? 'Peor hora del día:' : 'Peor hora del rango:'}{' '}
          <strong>{hourLabel(peak.Hora)}</strong> con{' '}
          <strong>{fmtPct((peak.Error / peak.Total) * 100)} de Error</strong> (
          {fmtNum(peak.Error)} de {fmtNum(peak.Total)} líneas
          {rangoDeUnDia ? '' : ' sumando todos los días'}).
        </p>
      )}
    </div>
  );
}

export default HourlyTimeline;
