import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Home, Store, Inbox } from 'lucide-react';

ChartJS.register(ArcElement, Tooltip, Legend);

/* ─────────────────── Reparto por tipo de surtido ───────────────────
 * Dos pasteles sobre el mismo universo filtrado:
 *   · Líneas  — qué % del volumen va por Entrega a domicilio vs C&C.
 *   · Errores — qué % del Error total aporta cada surtido.
 * El color es FIJO por segmento (domicilio siempre morado, C&C siempre
 * teal): la identidad se lee igual en ambos pasteles y en la leyenda. */

const SEGMENTOS = {
  domicilio: {
    label: 'Entrega a domicilio',
    color: '#833177',
    Icon: Home,
    desc: 'Fulfillment_Type_Liverpool',
  },
  cnc: {
    label: 'Click & Collect',
    color: '#0d9488',
    Icon: Store,
    desc: 'Liverpool_CNC_PICK_PACK',
  },
  otro: {
    label: 'Otro surtido',
    color: '#94a3b8',
    Icon: null,
    desc: 'Tipos de surtido fuera de los dos principales',
  },
};

const fmtNum = (n) => n.toLocaleString('es-MX');
const fmtPct = (n) => `${n.toFixed(1).replace(/\.0$/, '')}%`;

function PieSurtido({ titulo, slices, whole, unidad, fontFamily, surface }) {
  if (whole === 0) {
    return (
      <div className="fpies__col">
        <h3 className="fpies__title">{titulo}</h3>
        <div className="errorpie__empty">
          <Inbox size={28} strokeWidth={1.6} />
          <p>Sin {unidad} para este rango y filtros.</p>
        </div>
      </div>
    );
  }

  const chartData = {
    labels: slices.map((s) => s.meta.label),
    datasets: [
      {
        data: slices.map((s) => s.valor),
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
          label: (ctx) => `  ${fmtPct((ctx.parsed / whole) * 100)}  ·  ${fmtNum(ctx.parsed)} ${unidad}`,
          afterLabel: (ctx) => {
            const s = slices[ctx.dataIndex];
            if (!s) return '';
            return unidad === 'líneas'
              ? `  ${fmtNum(s.errores)} con Error (tasa ${fmtPct(s.tasaError)})`
              : `  de ${fmtNum(s.total)} líneas del surtido (tasa ${fmtPct(s.tasaError)})`;
          },
        },
      },
    },
  };

  return (
    <div className="fpies__col">
      <h3 className="fpies__title">{titulo}</h3>
      <div className="errorpie__chart">
        <Doughnut data={chartData} options={options} />
        <div className="errorpie__center">
          <strong>{fmtNum(whole)}</strong>
          <span>{unidad} en el rango</span>
        </div>
      </div>
      <ul className="errorpie__legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="errorpie__swatch" style={{ background: s.meta.color }} />
            <span className="errorpie__code" title={s.meta.desc}>
              {s.meta.Icon && <s.meta.Icon size={12} />} {s.meta.label}
              <em className="channelpie__tasa"> · tasa {fmtPct(s.tasaError)}</em>
            </span>
            <span className="errorpie__pct">{fmtPct((s.valor / whole) * 100)}</span>
            <span className="errorpie__abs">{fmtNum(s.valor)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FulfillmentPies({ segments }) {
  const root = getComputedStyle(document.documentElement);
  const surface = root.getPropertyValue('--surface').trim() || '#ffffff';
  const fontFamily = root.getPropertyValue('--font-sans').trim() || 'Roboto, sans-serif';

  /* Segmentos con datos, en orden fijo (domicilio, cnc, otro) */
  const base = ['domicilio', 'cnc', 'otro']
    .map((key) => {
      const seg = segments?.[key] || { total: 0, errores: 0 };
      return {
        key,
        meta: SEGMENTOS[key],
        total: seg.total,
        errores: seg.errores,
        tasaError: seg.total ? (seg.errores / seg.total) * 100 : 0,
      };
    })
    .filter((s) => s.total > 0);

  const totalLineas = base.reduce((a, s) => a + s.total, 0);
  const totalErrores = base.reduce((a, s) => a + s.errores, 0);

  return (
    <div className="fpies">
      <PieSurtido
        titulo="Reparto de líneas"
        slices={base.map((s) => ({ ...s, valor: s.total }))}
        whole={totalLineas}
        unidad="líneas"
        fontFamily={fontFamily}
        surface={surface}
      />
      <PieSurtido
        titulo="Reparto del Error"
        slices={base.filter((s) => s.errores > 0).map((s) => ({ ...s, valor: s.errores }))}
        whole={totalErrores}
        unidad="errores"
        fontFamily={fontFamily}
        surface={surface}
      />
    </div>
  );
}

export default FulfillmentPies;
