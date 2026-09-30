import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const monthAbbr = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

const NOMBRE_CORTO = { ERROR: 'Error', PLAN_B: 'Plan B', PLAN_A: 'Plan A' };

/* Verde de "en regla": el mismo que usan los estados ok del centro de alertas */
const VERDE_OK = '#16a34a';

/* ─────────────────── Gráfica de alertas por día ───────────────────
 * Una barra por día con los PUNTOS PORCENTUALES fuera del umbral: exceso
 * sobre el máximo (Plan B, Error) o déficit bajo el mínimo (Plan A). Los
 * días en regla quedan vacíos, así los afectados se identifican de un
 * vistazo y la altura dice qué tan grave fue el rebase. Mismo eje para
 * las tres series porque todas comparten unidad (pp de desviación). */

function AlertBars({ data, breaches }) {
  const root = getComputedStyle(document.documentElement);
  const planAColor = root.getPropertyValue('--plan-a').trim() || '#ac75a4';
  const planBColor = root.getPropertyValue('--plan-b').trim() || '#f0b133';
  const errorColor = root.getPropertyValue('--error').trim() || '#ff3333';
  const text3 = root.getPropertyValue('--text-3').trim() || '#767676';
  const border = root.getPropertyValue('--border').trim() || '#ebebeb';
  const fontFamily = root.getPropertyValue('--font-sans').trim() || 'Roboto, sans-serif';

  /* Índice fecha → {tipo → breach} para armar las series día a día */
  const porDia = {};
  for (const b of breaches) {
    (porDia[b.fecha] = porDia[b.fecha] || {})[b.tipo] = b;
  }

  const labels = data.map((d) => {
    const [, m, day] = d.Fecha.split('-');
    return `${parseInt(day, 10)} ${monthAbbr[parseInt(m, 10) - 1]}`;
  });

  /* Desviación en pp: cuánto rebasó el máximo, o cuánto faltó al mínimo */
  const desviacion = (fecha, tipo) => {
    const b = porDia[fecha]?.[tipo];
    if (!b) return 0;
    return tipo === 'PLAN_A' ? b.umbral - b.valor : b.valor - b.umbral;
  };

  const serie = (tipo) => data.map((d) => desviacion(d.Fecha, tipo));

  /* Días en regla: con datos y sin NINGÚN umbral roto — llevan palomita
     verde sobre la línea base para confirmar visualmente el cumplimiento. */
  const enRegla = data.map((d, i) => (d.Total > 0 && !porDia[d.Fecha] ? i : -1)).filter((i) => i >= 0);

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Error sobre el máximo',
        tipo: 'ERROR',
        data: serie('ERROR'),
        backgroundColor: errorColor,
        borderRadius: { topLeft: 3, topRight: 3 },
        borderSkipped: false,
      },
      {
        label: 'Plan B sobre el máximo',
        tipo: 'PLAN_B',
        data: serie('PLAN_B'),
        backgroundColor: planBColor,
        borderRadius: { topLeft: 3, topRight: 3 },
        borderSkipped: false,
      },
      {
        label: 'Plan A bajo el mínimo',
        tipo: 'PLAN_A',
        data: serie('PLAN_A'),
        backgroundColor: planAColor,
        borderRadius: { topLeft: 3, topRight: 3 },
        borderSkipped: false,
      },
      /* Serie "fantasma" (todo ceros): existe para que la leyenda muestre el
         verde de en-regla y para poder ocultar las palomitas desde ahí; las
         dibuja el plugin okMarkers, no las barras. */
      {
        label: 'Día en regla ✓',
        tipo: 'OK',
        data: data.map(() => 0),
        backgroundColor: VERDE_OK,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 500, easing: 'easeOutQuart' },
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        labels: {
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 16,
          font: { family: fontFamily, size: 11, weight: '600' },
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
        /* Solo los rubros que sí rompieron umbral ese día */
        filter: (item) => item.parsed.y > 0,
        callbacks: {
          label: (ctx) => {
            const b = porDia[data[ctx.dataIndex]?.Fecha]?.[ctx.dataset.tipo];
            if (!b) return null;
            const regla = ctx.dataset.tipo === 'PLAN_A' ? 'mínimo' : 'máximo';
            const verbo = ctx.dataset.tipo === 'PLAN_A' ? 'déficit' : 'exceso';
            return `  ${NOMBRE_CORTO[ctx.dataset.tipo]}: ${b.valor.toFixed(2)}% · ${regla} ${b.umbral}% · ${verbo} ${ctx.parsed.y.toFixed(2)} pp`;
          },
          footer: (items) => {
            const d = data[items[0]?.dataIndex];
            if (!d) return '';
            if (!d.Total) return 'Sin datos este día';
            return porDia[d.Fecha] ? '' : '✓ En regla: cumplió los umbrales configurados';
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
          font: { family: fontFamily, size: 10, weight: '600' },
          color: text3,
          maxRotation: 45,
          minRotation: 45,
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
          callback: (v) => `${v} pp`,
        },
        title: {
          display: true,
          text: 'pp fuera del umbral',
          font: { family: fontFamily, size: 10, weight: '600' },
          color: text3,
        },
      },
    },
  };

  /* Palomitas verdes sobre la línea base en los días en regla. Se dibujan
     dentro del área de la gráfica (no como barras) para no mentirle al eje
     de pp; si el slot por día es muy angosto, degradan a puntos. */
  const okMarkers = {
    id: 'okMarkers',
    afterDatasetsDraw(chart) {
      const { ctx, scales, chartArea } = chart;
      if (!scales?.x || !scales?.y || !chartArea) return;
      const idxOK = chart.data.datasets.findIndex((ds) => ds.tipo === 'OK');
      if (idxOK >= 0 && !chart.isDatasetVisible(idxOK)) return; // toggle desde la leyenda

      const y0 = scales.y.getPixelForValue(0);
      const slot = (chartArea.right - chartArea.left) / Math.max(1, data.length);
      const compacto = slot < 14; // rangos largos: punto en vez de palomita

      ctx.save();
      enRegla.forEach((i) => {
        const x = scales.x.getPixelForValue(i);
        const y = y0 - (compacto ? 5 : 10);
        ctx.beginPath();
        ctx.arc(x, y, compacto ? 3 : 6.5, 0, Math.PI * 2);
        ctx.fillStyle = VERDE_OK;
        ctx.fill();
        if (!compacto) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(x - 2.6, y + 0.2);
          ctx.lineTo(x - 0.7, y + 2.2);
          ctx.lineTo(x + 2.8, y - 2.2);
          ctx.stroke();
        }
      });
      ctx.restore();
    },
  };

  return <Bar data={chartData} options={options} plugins={[okMarkers]} />;
}

export default AlertBars;
