import { useMemo, useState, useCallback } from 'react';

/* ─────────────────── Tiempo de respuesta por llamada ───────────────────
 * Strip plot con un carril por estatus ATP: cada punto es una llamada única
 * a OMS (SKU + cantidad + CP). La identidad la dan el carril y su etiqueta —
 * el color solo refuerza — y el detalle vive en el tooltip (hover o Tab) y
 * en la tabla de la vista, así que nada depende únicamente del color.
 * Mismo diseño que el reporte ejecutivo estático de decomm. */

const LANES = [
  { status: 'CORRECTO', label: '✓ Correcto', sub: 'con promesa de entrega', color: 'var(--success)' },
  { status: 'NOT_ENOUGH_PRODUCT_CHOICES', label: '⚠ NEPC', sub: 'sin opciones de producto', color: 'var(--danger)' },
  { status: 'TIMEOUT', label: '⏱ Timeout', sub: '> 20 s sin respuesta', color: 'var(--warning)' },
  { status: 'OTRO_ERROR', label: '✕ Otro error', sub: 'respuesta inesperada', color: 'var(--viz-standard, #64748b)' },
];

const W = 920;
const LABEL_W = 150;
const RIGHT_PAD = 30;
const PAD_TOP = 26;
const PAD_BOTTOM = 34;
const R = 5; // radio del punto
const STACK = 13; // separación vertical del beeswarm
const PLOT_W = W - LABEL_W - RIGHT_PAD;

const fmtS = (n) =>
  Number(n).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function AtpLatencyChart({ calls, timeoutSeconds = 20 }) {
  const [tip, setTip] = useState(null); // { x, y, call, lane }

  /* El eje se adapta al timeout configurado: el límite queda cerca del borde
     derecho, con un respiro de 1 s para los puntos que lo cruzan. */
  const xmax = timeoutSeconds + 1;
  const xs = useCallback(
    (v) => LABEL_W + (Math.min(v, xmax) / xmax) * PLOT_W,
    [xmax]
  );
  const ticks = useMemo(() => {
    const t = [];
    for (let v = 0; v <= timeoutSeconds; v += 5) t.push(v);
    return t;
  }, [timeoutSeconds]);

  /* Beeswarm determinista: por carril, puntos ordenados por segundos; si un
     punto queda a menos de un diámetro del último de su nivel, sube de nivel. */
  const lanes = useMemo(() => {
    let yCursor = PAD_TOP;
    return LANES.map((lane) => {
      const pts = calls
        .filter((c) => c.status === lane.status)
        .slice()
        .sort((a, b) => a.seconds - b.seconds)
        .map((c) => ({ ...c }));
      if (pts.length === 0) return null;

      const lastAt = [];
      for (const p of pts) {
        let lvl = 0;
        while (lastAt[lvl] !== undefined && xs(p.seconds) - lastAt[lvl] < R * 2 + 3) lvl += 1;
        lastAt[lvl] = xs(p.seconds);
        p.lvl = lvl;
      }
      const depth = Math.max(1, ...pts.map((p) => p.lvl + 1));
      const h = Math.max(46, depth * STACK + 22);
      const laneOut = { ...lane, pts, depth, h, y: yCursor };
      yCursor += h;
      return laneOut;
    }).filter(Boolean);
  }, [calls, xs]);

  const lanesH = lanes.reduce((a, l) => a + l.h, 0);
  const H = PAD_TOP + lanesH + PAD_BOTTOM;

  const showTip = useCallback((e, call, lane) => {
    setTip({ x: e.clientX + 14, y: e.clientY + 14, call, lane });
  }, []);
  const showTipFromFocus = useCallback((e, call, lane) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ x: r.left + 16, y: r.top - 8, call, lane });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  if (lanes.length === 0) return null;

  return (
    <div className="atp-strip">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Tiempos de respuesta por llamada, agrupados por estatus ATP"
      >
        {/* gridlines + ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={xs(t)}
              y1={PAD_TOP}
              x2={xs(t)}
              y2={H - PAD_BOTTOM + 4}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={xs(t)}
              y={H - PAD_BOTTOM + 18}
              textAnchor="middle"
              fontSize="11"
              fill="var(--text-muted)"
            >
              {t}
            </text>
          </g>
        ))}
        <text
          x={xs(xmax / 2)}
          y={H - 6}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-muted)"
        >
          segundos de respuesta
        </text>

        {/* límite configurado (timeout de la corrida) */}
        <line
          x1={xs(timeoutSeconds)}
          y1={PAD_TOP - 4}
          x2={xs(timeoutSeconds)}
          y2={H - PAD_BOTTOM + 4}
          stroke="var(--danger)"
          strokeWidth="1"
          strokeDasharray="4 3"
          opacity="0.8"
        />
        <text
          x={xs(timeoutSeconds)}
          y={PAD_TOP - 10}
          textAnchor="end"
          fontSize="11"
          fill="var(--danger)"
        >
          límite {timeoutSeconds} s
        </text>

        {lanes.map((lane, li) => {
          const yMid = lane.y + lane.h / 2;
          const yBase = yMid + ((lane.depth - 1) * STACK) / 2 - 2;
          return (
            <g key={lane.status}>
              {li > 0 && (
                <line
                  x1={LABEL_W}
                  y1={lane.y}
                  x2={W - RIGHT_PAD}
                  y2={lane.y}
                  stroke="var(--border)"
                  strokeWidth="1"
                  opacity="0.6"
                />
              )}
              <text
                x={LABEL_W - 12}
                y={yMid}
                textAnchor="end"
                fontSize="12.5"
                fontWeight="600"
                fill="var(--text-1)"
              >
                {lane.label}
              </text>
              <text
                x={LABEL_W - 12}
                y={yMid + 15}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-muted)"
              >
                {lane.pts.length} {lane.pts.length === 1 ? 'llamada' : 'llamadas'}
              </text>

              {lane.pts.map((p, i) => {
                const cx = xs(p.seconds);
                const cy = yBase - p.lvl * STACK;
                return (
                  <g
                    key={`${p.sku}-${p.zipCode}-${i}`}
                    className="atp-strip__hit"
                    tabIndex={0}
                    role="img"
                    aria-label={`${lane.label.slice(2)}: ${p.sku}, ${fmtS(p.seconds)} segundos, CP ${p.zipCode}`}
                    onPointerMove={(e) => showTip(e, p, lane)}
                    onPointerLeave={hideTip}
                    onFocus={(e) => showTipFromFocus(e, p, lane)}
                    onBlur={hideTip}
                  >
                    {/* hit target ≥24px + anillo de superficie + punto */}
                    <circle cx={cx} cy={cy} r="12" fill="transparent" />
                    <circle cx={cx} cy={cy} r={R + 2} fill="var(--surface)" />
                    <circle cx={cx} cy={cy} r={R} fill={lane.color} className="atp-strip__mark" />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {tip && (
        <div
          className="atp-strip__tip"
          style={{
            left: Math.min(tip.x, window.innerWidth - 240),
            top: Math.min(tip.y, window.innerHeight - 120),
          }}
          role="tooltip"
        >
          <div className="atp-strip__tip-v">
            <span className="atp-strip__tip-dot" style={{ background: tip.lane.color }} />
            <b>{fmtS(tip.call.seconds)} s</b>&nbsp;· {tip.lane.label.slice(2)}
          </div>
          <div className="atp-strip__tip-r">
            <b>{tip.call.sku}</b> · cant. {tip.call.quantity}
          </div>
          <div className="atp-strip__tip-r">
            CP <b>{tip.call.zipCode}</b>
            {tip.call.shipNode ? (
              <>
                {' '}· nodo <b>{tip.call.shipNode}</b>
              </>
            ) : null}
          </div>
          {tip.call.deliveryDate ? (
            <div className="atp-strip__tip-r">promesa {String(tip.call.deliveryDate).slice(0, 10)}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default AtpLatencyChart;
