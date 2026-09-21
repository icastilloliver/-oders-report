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

function BarChart({ data, hideError = false }) {
  // Lee la fuente y los colores desde las CSS custom properties para
  // mantener consistencia con el resto del dashboard.
  const root = getComputedStyle(document.documentElement);
  const planAColor = root.getPropertyValue('--plan-a').trim() || '#09ac38';
  const planBColor = root.getPropertyValue('--plan-b').trim() || '#f0b133';
  const errorColor = root.getPropertyValue('--error').trim() || '#ff3333';
  const text3 = root.getPropertyValue('--text-3').trim() || '#767676';
  const border = root.getPropertyValue('--border').trim() || '#ebebeb';
  const fontFamily = root.getPropertyValue('--font-sans').trim() || 'Roboto, sans-serif';

  const labels = data.map((d) => {
    const [y, m, day] = d.Fecha.split('-');
    return `${parseInt(day, 10)} ${monthAbbr[parseInt(m, 10) - 1]} ${y}`;
  });

  const pctOf = (val, total) => (total ? (val / total) * 100 : 0);
  const pctA = data.map((d) => pctOf(d.Plan_A, d.Total));
  const pctB = data.map((d) => pctOf(d.Plan_B, d.Total));
  const pctE = data.map((d) => pctOf(d.Error, d.Total));

  const datasets = [
    {
      label: 'Plan A',
      data: pctA,
      absolute: data.map((d) => d.Plan_A),
      backgroundColor: planAColor,
      borderRadius: { topLeft: 4, topRight: 4 },
      borderSkipped: false,
    },
    {
      label: 'Plan B',
      data: pctB,
      absolute: data.map((d) => d.Plan_B),
      backgroundColor: planBColor,
      // Si el Error está oculto, Plan B queda hasta arriba del stack
      borderRadius: hideError ? { topLeft: 4, topRight: 4 } : 0,
      borderSkipped: false,
    },
  ];

  if (!hideError) {
    datasets.push({
      label: 'Error',
      data: pctE,
      absolute: data.map((d) => d.Error),
      backgroundColor: errorColor,
      borderRadius: { topLeft: 4, topRight: 4 },
      borderSkipped: false,
    });
  }

  const chartData = { labels, datasets };

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

export default BarChart;
