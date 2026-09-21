import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const monthAbbr = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/**
 * Barra 100% apilada por día con la composición de tipos de entrega:
 * Flash Mismo Día, Siguiente Día, Estándar y Sin EDD.
 * Colores desde CSS custom properties (--viz-*) para respetar el tema.
 */
function DeliveryChart({ data }) {
  const root = getComputedStyle(document.documentElement);
  const flashColor = root.getPropertyValue('--viz-flash').trim() || '#ac75a4';
  const nextdayColor = root.getPropertyValue('--viz-nextday').trim() || '#37abc6';
  const standardColor = root.getPropertyValue('--viz-standard').trim() || '#767676';
  const noeddColor = root.getPropertyValue('--viz-noedd').trim() || '#ff0000';
  const surface = root.getPropertyValue('--surface').trim() || '#ffffff';
  const text3 = root.getPropertyValue('--text-3').trim() || '#767676';
  const border = root.getPropertyValue('--border').trim() || '#ebebeb';
  const fontFamily = root.getPropertyValue('--font-sans').trim() || 'Roboto, sans-serif';

  const labels = data.map((d) => {
    const [y, m, day] = d.Fecha.split('-');
    return `${parseInt(day, 10)} ${monthAbbr[parseInt(m, 10) - 1]} ${y}`;
  });

  const pctOf = (val, total) => (total ? (val / total) * 100 : 0);

  const series = [
    { key: 'Flash', label: 'Flash Mismo Día', color: flashColor },
    { key: 'Siguiente_Dia', label: 'Siguiente Día', color: nextdayColor },
    { key: 'Estandar', label: 'Estándar', color: standardColor },
    { key: 'Sin_EDD', label: 'Sin EDD', color: noeddColor },
  ];

  const chartData = {
    labels,
    datasets: series.map((s, i) => ({
      label: s.label,
      data: data.map((d) => pctOf(d[s.key], d.Total)),
      absolute: data.map((d) => d[s.key]),
      backgroundColor: s.color,
      // Separador de 2px color superficie entre segmentos apilados
      borderColor: surface,
      borderWidth: { top: 2 },
      borderSkipped: false,
      borderRadius:
        i === series.length - 1 ? { topLeft: 4, topRight: 4 } : 0,
    })),
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: {
      duration: 600,
      easing: 'easeOutQuart',
    },
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
        callbacks: {
          label: (ctx) => {
            const pct = ctx.parsed.y.toFixed(2);
            const abs = ctx.dataset.absolute[ctx.dataIndex];
            return `  ${ctx.dataset.label}: ${pct}%  ·  ${abs.toLocaleString('es-MX')}`;
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
        max: 100,
        grid: { color: border, drawTicks: false },
        border: { display: false },
        ticks: {
          font: { family: fontFamily, size: 12 },
          color: text3,
          stepSize: 20,
          padding: 8,
          callback: (v) => v + '%',
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

export default DeliveryChart;
