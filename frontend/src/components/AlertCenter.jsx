import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  Save,
  CheckCircle2,
  AlertTriangle,
  Inbox,
} from 'lucide-react';
import AlertBars from './AlertBars.jsx';

/* ─────────────────── Alertas y umbrales ───────────────────
 * Control de SLA del tablero: se configura un mínimo de Plan A y máximos
 * de Plan B / Error (por compañía, guardados en BigQuery) y cada día del
 * rango en pantalla que rompa un umbral genera una alerta. La campana del
 * header muestra el conteo; aquí vive el detalle y la configuración. */

const TIPO_META = {
  PLAN_A: { label: 'Plan A', cssVar: '--plan-a', regla: 'debajo del mínimo' },
  PLAN_B: { label: 'Plan B', cssVar: '--plan-b', regla: 'sobre el máximo' },
  ERROR: { label: 'Error', cssVar: '--error', regla: 'sobre el máximo' },
};

const monthAbbr = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtFecha = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${monthAbbr[parseInt(m, 10) - 1]} ${y}`;
};

/* El input maneja strings ('' = sin umbral); a la API van números o null. */
const aNumero = (s) => {
  if (s === '' || s === null || s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const aTexto = (n) => (n === null || n === undefined ? '' : String(n));

function AlertCenter({ company, thresholds, onSaved, breaches, data }) {
  const [planAMin, setPlanAMin] = useState('');
  const [planBMax, setPlanBMax] = useState('');
  const [errorMax, setErrorMax] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false); // feedback "Guardado ✓"
  const [error, setError] = useState(null);

  /* Repobla el formulario al cambiar de compañía o llegar la config */
  useEffect(() => {
    setPlanAMin(aTexto(thresholds?.planAMin));
    setPlanBMax(aTexto(thresholds?.planBMax));
    setErrorMax(aTexto(thresholds?.errorMax));
    setEnabled(thresholds ? thresholds.enabled : true);
    setError(null);
    setGuardado(false);
  }, [thresholds, company]);

  /* Agregado del rango en pantalla: para los chips de estado */
  const agregado = useMemo(() => {
    if (!data?.length) return null;
    const tot = data.reduce(
      (a, d) => ({
        total: a.total + d.Total,
        pa: a.pa + d.Plan_A,
        pb: a.pb + d.Plan_B,
        err: a.err + d.Error,
      }),
      { total: 0, pa: 0, pb: 0, err: 0 }
    );
    if (!tot.total) return null;
    return {
      PLAN_A: (tot.pa / tot.total) * 100,
      PLAN_B: (tot.pb / tot.total) * 100,
      ERROR: (tot.err / tot.total) * 100,
    };
  }, [data]);

  const guardar = async (e) => {
    e.preventDefault();
    if (guardando) return;
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      const res = await fetch('/api/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company,
          planAMin: aNumero(planAMin),
          planBMax: aNumero(planBMax),
          errorMax: aNumero(errorMax),
          enabled,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onSaved(json.data);
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  /* Estado del umbral contra el agregado del rango: ok | fuera | sin dato.
     Epsilon contra falsos "fuera" de punto flotante en el umbral exacto. */
  const estadoDe = (tipo, umbral) => {
    if (umbral === null || !agregado) return null;
    const EPS = 1e-9;
    const valor = agregado[tipo];
    const fuera = tipo === 'PLAN_A' ? valor < umbral - EPS : valor > umbral + EPS;
    return { valor, fuera };
  };

  const umbrales = [
    { tipo: 'PLAN_A', valor: aNumero(planAMin), set: setPlanAMin, texto: planAMin, label: 'Plan A mínimo', hint: 'alerta si el día cae debajo' },
    { tipo: 'PLAN_B', valor: aNumero(planBMax), set: setPlanBMax, texto: planBMax, label: 'Plan B máximo', hint: 'alerta si el día lo rebasa' },
    { tipo: 'ERROR', valor: aNumero(errorMax), set: setErrorMax, texto: errorMax, label: 'Error máximo', hint: 'alerta si el día lo rebasa' },
  ];

  const hayUmbral = umbrales.some((u) => u.valor !== null);

  return (
    <div className="alertc">
      {/* ── Configuración ── */}
      <form className="alertc__config" onSubmit={guardar}>
        {umbrales.map((u) => (
          <div className="alertc__umbral" key={u.tipo}>
            <label htmlFor={`umbral-${u.tipo}`}>
              <span
                className="alertc__dot"
                style={{ background: `var(${TIPO_META[u.tipo].cssVar})` }}
              />
              {u.label}
            </label>
            <div className="alertc__input">
              <input
                id={`umbral-${u.tipo}`}
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                placeholder="—"
                value={u.texto}
                onChange={(e) => u.set(e.target.value)}
                title={u.hint}
              />
              <span className="alertc__pct">%</span>
            </div>
          </div>
        ))}

        <button
          type="button"
          className={`chip ${enabled ? 'active' : ''}`}
          onClick={() => setEnabled((v) => !v)}
          title="Pausa el alertamiento sin perder los umbrales"
          aria-pressed={enabled}
        >
          {enabled ? <Bell size={12} /> : <BellOff size={12} />}
          {enabled ? 'Alertamiento activo' : 'Alertamiento pausado'}
        </button>

        <button type="submit" className="btn-primary" disabled={guardando || !hayUmbral}>
          <Save size={14} />
          {guardando ? 'Guardando…' : 'Guardar umbrales'}
        </button>

        {guardado && (
          <span className="alertc__ok">
            <CheckCircle2 size={14} /> Guardado
          </span>
        )}
        {error && <span className="alertc__err">{error}</span>}
      </form>

      {thresholds?.updatedAt && (
        <p className="alertc__meta">
          Última actualización: {thresholds.updatedAt} (CDMX) · los umbrales se guardan por
          compañía y los ve todo el equipo
        </p>
      )}

      {/* ── Estado del rango contra cada umbral ── */}
      {thresholds && agregado && (
        <div className="alertc__estado" role="list" aria-label="Estado del rango">
          {umbrales.map((u) => {
            const cfg = thresholds[u.tipo === 'PLAN_A' ? 'planAMin' : u.tipo === 'PLAN_B' ? 'planBMax' : 'errorMax'];
            const st = estadoDe(u.tipo, cfg ?? null);
            if (!st) return null;
            return (
              <span
                key={u.tipo}
                role="listitem"
                className={`alertc__pill ${st.fuera ? 'alertc__pill--fuera' : 'alertc__pill--ok'}`}
              >
                <span
                  className="alertc__dot"
                  style={{ background: `var(${TIPO_META[u.tipo].cssVar})` }}
                />
                {TIPO_META[u.tipo].label} del rango: {st.valor.toFixed(2)}%
                {' · '}umbral {u.tipo === 'PLAN_A' ? '≥' : '≤'} {cfg}%
                {st.fuera ? ' · fuera' : ' · en regla'}
              </span>
            );
          })}
        </div>
      )}

      {/* ── Alertas día por día ── */}
      {!thresholds && (
        <div className="alertc__empty">
          <Inbox size={18} />
          Configura y guarda umbrales para activar el alertamiento de {company}.
        </div>
      )}
      {thresholds && !thresholds.enabled && (
        <div className="alertc__empty">
          <BellOff size={18} />
          Alertamiento pausado — actívalo para evaluar el rango contra los umbrales.
        </div>
      )}
      {thresholds?.enabled && breaches.length === 0 && (
        <div className="alertc__empty alertc__empty--ok">
          <CheckCircle2 size={18} />
          Todos los días del rango están dentro de los umbrales.
        </div>
      )}
      {/* ── Gráfica: pp fuera del umbral por día — los días afectados se
             identifican de un vistazo (la altura es la severidad) y los que
             cumplieron llevan palomita verde. Se muestra aunque no haya
             alertas: un rango limpio se ve todo en verde. ── */}
      {thresholds?.enabled && data?.length > 0 && (
        <div className="alertc__chart">
          <AlertBars data={data} breaches={breaches} />
        </div>
      )}

      {thresholds?.enabled && breaches.length > 0 && (
        <div className="alertc__alerts" aria-label="Alertas por día">
          {breaches.map((b) => (
            <div
              key={`${b.fecha}-${b.tipo}`}
              className="alertc__alert"
              style={{ '--alert-color': `var(${TIPO_META[b.tipo].cssVar})` }}
            >
              <AlertTriangle size={14} className="alertc__alert-icon" />
              <span className="alertc__alert-fecha">{fmtFecha(b.fecha)}</span>
              <span className="alertc__badge">{TIPO_META[b.tipo].label}</span>
              <span className="alertc__alert-texto">
                {b.valor.toFixed(2)}% — {TIPO_META[b.tipo].regla} ({b.tipo === 'PLAN_A' ? '≥' : '≤'} {b.umbral}%)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AlertCenter;
