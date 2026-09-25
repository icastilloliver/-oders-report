import { useState } from 'react';
import {
  Plus,
  X,
  Pencil,
  Trash2,
  AlertTriangle,
  Truck,
  Flag,
  Clock,
  Inbox,
} from 'lucide-react';
import CalendarWidget from './CalendarWidget.jsx';

/* ─────────────────── Timeline de incidencias ───────────────────
 * Bitácora manual de afectaciones: documenta POR QUÉ un día tuvo pico de
 * Plan B o de Error. Cada incidencia se marca también sobre la gráfica de
 * distribución diaria (indicador en el día) y aparece en su tooltip, para
 * que quien mire el tablero vea el pico Y su explicación juntos. */

const TIPOS = {
  PLAN_B: { label: 'Plan B', clase: 'inctl__badge--planb', Icon: Truck },
  ERROR: { label: 'Error', clase: 'inctl__badge--error', Icon: AlertTriangle },
  AMBOS: { label: 'Plan B + Error', clase: 'inctl__badge--ambos', Icon: Flag },
};

const monthAbbr = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtFecha = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${monthAbbr[parseInt(m, 10) - 1]} ${y}`;
};
/** "5 sep 2026" o "5 → 8 sep 2026 · 4 días" */
const fmtRango = (inc) => {
  if (!inc.fechaFin) return fmtFecha(inc.fecha);
  const dias =
    Math.round((new Date(inc.fechaFin) - new Date(inc.fecha)) / 86400000) + 1;
  return `${fmtFecha(inc.fecha)} → ${fmtFecha(inc.fechaFin)} · ${dias} días`;
};

const fmtHoras = (inc) =>
  inc.horaInicio === null || inc.horaInicio === undefined
    ? 'Todo el día'
    : `${String(inc.horaInicio).padStart(2, '0')}:00 → ${String(inc.horaFin).padStart(2, '0')}:59`;

const HORAS = Array.from({ length: 24 }, (_, h) => String(h));

/* Paleta fija de colores de línea: opciones legibles y distinguibles entre
   sí (no un picker libre que degenera en tonos ilegibles). */
const PALETA = ['#ef4444', '#f59e0b', '#f97316', '#8b5cf6', '#3b82f6', '#14b8a6', '#16a34a', '#ec4899', '#64748b'];
const COLOR_POR_TIPO = { ERROR: '#ef4444', PLAN_B: '#f59e0b', AMBOS: '#8b5cf6' };

function IncidentTimeline({ incidents, company, defaultDate, onChanged }) {
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState(null); // id en confirmación
  const [editandoId, setEditandoId] = useState(null); // id en edición (form precargado)
  const [error, setError] = useState(null);

  const [fecha, setFecha] = useState(defaultDate);
  const [fechaFin, setFechaFin] = useState('');
  const [horaIni, setHoraIni] = useState('');
  const [horaFin, setHoraFin] = useState('');
  const [tipo, setTipo] = useState('ERROR');
  const [color, setColor] = useState(COLOR_POR_TIPO.ERROR);
  const [colorTocado, setColorTocado] = useState(false); // el usuario eligió a mano
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');

  const limpiar = () => {
    setEditandoId(null);
    setFecha(defaultDate);
    setFechaFin('');
    setHoraIni('');
    setHoraFin('');
    setTipo('ERROR');
    setColor(COLOR_POR_TIPO.ERROR);
    setColorTocado(false);
    setTitulo('');
    setDescripcion('');
    setError(null);
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!titulo.trim()) {
      setError('Escribe un título breve de la afectación.');
      return;
    }
    if ((horaIni === '') !== (horaFin === '')) {
      setError('Completa ambas horas del horario, o déjalas vacías para "todo el día".');
      return;
    }
    if (fechaFin && fechaFin < fecha) {
      setError('La fecha fin no puede ser anterior a la fecha de inicio.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const body = { company, fecha, tipo, titulo: titulo.trim(), descripcion: descripcion.trim() };
      if (fechaFin && fechaFin !== fecha) body.fechaFin = fechaFin;
      if (horaIni !== '') {
        body.horaInicio = Number(horaIni);
        body.horaFin = Number(horaFin);
      }
      body.color = color;
      if (editandoId) body.id = editandoId;
      const res = await fetch('/api/incidents', {
        method: editandoId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      limpiar();
      setAbierto(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  /** Precarga el formulario con una incidencia existente */
  const editar = (inc) => {
    setEditandoId(inc.id);
    setFecha(inc.fecha);
    setFechaFin(inc.fechaFin || '');
    setHoraIni(inc.horaInicio === null || inc.horaInicio === undefined ? '' : String(inc.horaInicio));
    setHoraFin(inc.horaFin === null || inc.horaFin === undefined ? '' : String(inc.horaFin));
    setTipo(inc.tipo);
    setColor(inc.color || COLOR_POR_TIPO[inc.tipo] || COLOR_POR_TIPO.ERROR);
    setColorTocado(Boolean(inc.color));
    setTitulo(inc.titulo);
    setDescripcion(inc.descripcion || '');
    setError(null);
    setBorrando(null);
    setAbierto(true);
  };

  const eliminar = async (id) => {
    try {
      const res = await fetch(`/api/incidents?id=${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      setBorrando(null);
      onChanged();
    } catch (err) {
      setError(`No se pudo eliminar: ${err.message}`);
    }
  };

  return (
    <div className="inctl">
      <div className="inctl__toolbar">
        <button
          type="button"
          className={abierto ? 'chip active' : 'btn-primary inctl__add'}
          onClick={() => {
            setAbierto((v) => !v);
            if (!abierto) limpiar();
          }}
        >
          {abierto ? (
            <>
              <X size={13} /> Cancelar {editandoId ? 'edición' : ''}
            </>
          ) : (
            <>
              <Plus size={15} strokeWidth={2.4} /> Registrar incidencia
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          <AlertTriangle className="alert__icon" size={18} />
          <div>{error}</div>
        </div>
      )}

      {/* ── Formulario ── */}
      {abierto && (
        <form className="inctl__form" onSubmit={guardar}>
          {editandoId && (
            <p className="inctl__editing">
              <Pencil size={13} /> Editando la incidencia — los cambios sustituyen lo registrado.
            </p>
          )}
          <div className="inctl__form-row">
            <div className="field">
              <label htmlFor="inc-fecha">Desde</label>
              <CalendarWidget id="inc-fecha" value={fecha} onChange={setFecha} label="Inicio de la afectación" />
            </div>

            <div className="field">
              <label htmlFor="inc-fecha-fin">Hasta (si duró varios días)</label>
              <div className="inctl__horas">
                <CalendarWidget
                  id="inc-fecha-fin"
                  value={fechaFin}
                  onChange={setFechaFin}
                  label="Fin de la afectación"
                />
                {fechaFin && (
                  <button type="button" className="chip" onClick={() => setFechaFin('')}>
                    <X size={12} /> Un solo día
                  </button>
                )}
              </div>
            </div>

            <div className="field">
              <label>Horario (CDMX, opcional)</label>
              <div className="inctl__horas">
                <select className="hour-select" value={horaIni} onChange={(e) => setHoraIni(e.target.value)} aria-label="Hora inicio">
                  <option value="">Todo el día</option>
                  {HORAS.map((h) => (
                    <option key={h} value={h}>{`${h.padStart(2, '0')}:00`}</option>
                  ))}
                </select>
                <span>→</span>
                <select className="hour-select" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} aria-label="Hora fin">
                  <option value="">—</option>
                  {HORAS.map((h) => (
                    <option key={h} value={h}>{`${h.padStart(2, '0')}:59`}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>Afecta a</label>
              <div className="inctl__tipos">
                {Object.entries(TIPOS).map(([key, t]) => (
                  <button
                    key={key}
                    type="button"
                    className={`chip ${tipo === key ? 'active' : ''}`}
                    onClick={() => {
                      setTipo(key);
                      // el color sigue al tipo hasta que el usuario elija uno
                      if (!colorTocado) setColor(COLOR_POR_TIPO[key]);
                    }}
                  >
                    <t.Icon size={12} /> {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="field">
            <label>Color de la línea en la gráfica</label>
            <div className="inctl__swatches" role="radiogroup" aria-label="Color de la línea">
              {PALETA.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  className={`inctl__swatch ${color === c ? 'inctl__swatch--sel' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => {
                    setColor(c);
                    setColorTocado(true);
                  }}
                />
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="inc-titulo">Título</label>
            <input
              id="inc-titulo"
              className="inctl__input"
              type="text"
              maxLength={120}
              placeholder="Ej. Mantenimiento del motor de trazos — código 3 disparado"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="inc-desc">Descripción (opcional)</label>
            <textarea
              id="inc-desc"
              className="inctl__input"
              rows={3}
              maxLength={1000}
              placeholder="Contexto, ticket, responsable, resolución…"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={guardando}>
            {guardando ? (
              <>
                <span className="spinner" aria-hidden="true" /> Guardando…
              </>
            ) : editandoId ? (
              'Guardar cambios'
            ) : (
              'Guardar incidencia'
            )}
          </button>
        </form>
      )}

      {/* ── Timeline ── */}
      {incidents.length === 0 && !abierto && (
        <div className="search-empty search-empty--idle inctl__empty">
          <Inbox size={32} strokeWidth={1.6} />
          <h3>Sin incidencias registradas en este rango</h3>
          <p>
            Cuando un día tenga un pico de Plan B o de Error, regístralo aquí: quedará marcado
            sobre la gráfica y cualquiera del equipo verá qué sucedió.
          </p>
        </div>
      )}

      {incidents.length > 0 && (
        <ol className="inctl__list">
          {incidents.map((inc) => {
            const t = TIPOS[inc.tipo] || TIPOS.ERROR;
            return (
              <li key={inc.id} id={`inc-${inc.id}`} className={`inctl__item inctl__item--${inc.tipo.toLowerCase()}`}>
                <div
                  className="inctl__dot"
                  aria-hidden="true"
                  style={inc.color ? { background: inc.color } : undefined}
                />
                <div className="inctl__card">
                  <div className="inctl__card-head">
                    <span className="inctl__fecha">{fmtRango(inc)}</span>
                    <span className="inctl__horario">
                      <Clock size={11} /> {fmtHoras(inc)}
                    </span>
                    <span className={`inctl__badge ${t.clase}`}>
                      <t.Icon size={11} strokeWidth={2.4} /> {t.label}
                    </span>
                    <span className="inctl__spacer" />
                    {borrando === inc.id ? (
                      <>
                        <button type="button" className="chip inctl__confirm" onClick={() => eliminar(inc.id)}>
                          Confirmar eliminación
                        </button>
                        <button type="button" className="chip" onClick={() => setBorrando(null)}>
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="inctl__delete"
                          onClick={() => editar(inc)}
                          title="Editar incidencia"
                          aria-label={`Editar incidencia ${inc.titulo}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="inctl__delete"
                          onClick={() => setBorrando(inc.id)}
                          title="Eliminar incidencia"
                          aria-label={`Eliminar incidencia ${inc.titulo}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                  <h4 className="inctl__titulo">{inc.titulo}</h4>
                  {inc.descripcion && <p className="inctl__desc">{inc.descripcion}</p>}
                  <span className="inctl__meta">registrada el {inc.createdAt} h</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default IncidentTimeline;
