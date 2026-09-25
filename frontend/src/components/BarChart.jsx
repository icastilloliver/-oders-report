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

function BarChart({ data, hideError = false, incidents = [] }) {
  /* Incidencias por fecha: las multi-día se expanden a CADA día cubierto
     ([fecha, fechaFin]), así el indicador ▲ y el tooltip "Qué sucedió"
     aparecen en todos los días de la afectación. */
  const incidentsByDate = {};
  for (const inc of incidents) {
    const fin = inc.fechaFin || inc.fecha;
    let cursor = inc.fecha;
    for (let guard = 0; cursor <= fin && guard < 120; guard += 1) {
      (incidentsByDate[cursor] = incidentsByDate[cursor] || []).push(inc);
      const [y, m, d] = cursor.split('-').map(Number);
      const next = new Date(y, m - 1, d + 1);
      cursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    }
  }
  // Lee la fuente y los colores desde las CSS custom properties para
  // mantener consistencia con el resto del dashboard.
  const root = getComputedStyle(document.documentElement);
  const planAColor = root.getPropertyValue('--plan-a').trim() || '#ac75a4';
  const planBColor = root.getPropertyValue('--plan-b').trim() || '#f0b133';
  const errorColor = root.getPropertyValue('--error').trim() || '#ff3333';
  const surfaceColor = root.getPropertyValue('--surface').trim() || '#ffffff';
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


  /* Carriles de incidencias: cada evento va en su propia línea; si dos se
     solapan en fechas, el nuevo sube un carril (asignación greedy). Eventos
     que no se tocan comparten carril para no desperdiciar altura. */
  const lanedIncidents = (() => {
    const sorted = [...incidents].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
    const laneEnds = [];
    return sorted.map((inc) => {
      const fin = inc.fechaFin || inc.fecha;
      let lane = laneEnds.findIndex((end) => end < inc.fecha);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(fin);
      } else {
        laneEnds[lane] = fin;
      }
      return { ...inc, lane };
    });
  })();
  const numLanes = lanedIncidents.reduce((m, i) => Math.max(m, i.lane + 1), 0);

  /* Color de la línea: el elegido por el usuario, o el del tipo. */
  const colorDe = (inc) =>
    inc.color || (inc.tipo === 'PLAN_B' ? planBColor : inc.tipo === 'AMBOS' ? '#8b5cf6' : errorColor);

  /* Numeración cronológica: el globo ① ② ③ de la gráfica y la clave de
     abajo hablan del mismo evento. */
  const numerados = lanedIncidents.map((inc, i) => ({ ...inc, num: i + 1 }));

  /* La zona de carriles vive DENTRO del área de la gráfica: se le da aire
     al eje Y por encima de 100% (≈6 unidades por carril) y la leyenda queda
     naturalmente ARRIBA de todo, sin que nada la toque. Los ticks y las
     gridlines >100% se ocultan para que el eje siga leyéndose 0-100%. */
  const yMax = numLanes > 0 ? 100 + 4 + numLanes * 6 : 100;

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
          footer: (items) => {
            const i = items[0]?.dataIndex;
            if (i === undefined) return '';
            const incs = incidentsByDate[data[i]?.Fecha];
            if (!incs || incs.length === 0) return '';
            return [
              '⚑ Qué sucedió:',
              ...incs.map((inc) => {
                const n = numerados.find((x) => x.id === inc.id)?.num;
                const rango = inc.fechaFin ? ` (${inc.fecha.slice(8)}–${inc.fechaFin.slice(8)})` : '';
                return `· [${n}] ${inc.titulo}${rango}`;
              }),
            ].join('\n');
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
        max: yMax,
        grid: {
          color: (c) => (c.tick.value > 100 ? 'rgba(0,0,0,0)' : border),
          drawTicks: false,
        },
        border: { display: false },
        ticks: {
          font: { family: fontFamily, size: 12 },
          color: text3,
          stepSize: 20,
          padding: 8,
          callback: (v) => (v > 100 ? '' : v + '%'),
        },
      },
    },
  };

  const incidentMarkers = {
    id: 'incidentMarkers',
    afterDatasetsDraw(chart) {
      const { ctx, scales, chartArea } = chart;
      if (!scales?.x || !scales?.y || !chartArea || numLanes === 0) return;

      const barsTop = scales.y.getPixelForValue(100);
      const slot = (barsTop - chartArea.top) / numLanes;

      numerados.forEach((inc) => {
        const fin = inc.fechaFin || inc.fecha;
        const visibles = data
          .map((d, i) => (d.Fecha >= inc.fecha && d.Fecha <= fin ? i : -1))
          .filter((i) => i >= 0);
        if (visibles.length === 0) return;

        const lineY = barsTop - (inc.lane + 1) * slot + slot / 2;
        const color = colorDe(inc);
        const x1 = scales.x.getPixelForValue(visibles[0]);
        const x2 = scales.x.getPixelForValue(visibles[visibles.length - 1]);

        ctx.save();

        // Línea del rango con remates redondeados
        if (visibles.length > 1) {
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.moveTo(x1, lineY);
          ctx.lineTo(x2, lineY);
          ctx.stroke();
        }

        // Globo numerado al inicio del tramo: fondo superficie + aro del
        // color del evento + número oscuro — legible con cualquier color.
        ctx.globalAlpha = 1;
        const bx = Math.max(x1, chartArea.left + 9);
        ctx.beginPath();
        ctx.arc(bx, lineY, 8, 0, Math.PI * 2);
        ctx.fillStyle = surfaceColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.font = `700 9.5px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = text3;
        ctx.fillText(String(inc.num), bx, lineY + 0.5);

        ctx.restore();
      });
    },
  };

  const irATarjeta = (id) => {
    document.getElementById(`inc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <>
      <div className="chart-wrapper">
        <Bar id="daily-plan-chart" data={chartData} options={options} plugins={[incidentMarkers]} />
      </div>
      {numerados.length > 0 && (
        <div className="inckey" aria-label="Clave de incidencias">
          {numerados.map((inc) => (
            <button
              key={inc.id}
              type="button"
              className="inckey__item"
              onClick={() => irATarjeta(inc.id)}
              title="Ver en el timeline de incidencias"
            >
              <span className="inckey__num" style={{ borderColor: colorDe(inc) }}>
                {inc.num}
              </span>
              <span className="inckey__titulo">{inc.titulo}</span>
              <span className="inckey__rango">
                {inc.fecha.slice(5)}{inc.fechaFin ? ` → ${inc.fechaFin.slice(5)}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default BarChart;
