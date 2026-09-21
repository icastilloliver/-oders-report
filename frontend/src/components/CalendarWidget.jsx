import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Único componente de calendario del proyecto, estilizado según el
 * organism "CalendarWidget" (variante "default") del sistema de diseño:
 * https://symmetrical-bassoon-g3k1nnl.pages.github.io/?path=/docs/organisms-calendarwidget--documentation#default-11
 *
 * Cualquier selector de fecha nuevo debe reutilizar este componente en vez
 * de un <input type="date"> nativo (que el navegador no permite restylear)
 * para heredar automáticamente estos estilos.
 */

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const fromISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const sameDay = (a, b) =>
  !!a && !!b &&
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Cuadrícula de 6 semanas (lunes a domingo) que cubre el mes dado */
function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // 0 = lunes .. 6 = domingo
  const start = new Date(year, month, 1 - firstWeekday);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function CalendarWidget({ id, value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => (value ? fromISO(value) : new Date()));
  const wrapRef = useRef(null);

  const selected = value ? fromISO(value) : null;
  const today = new Date();

  useEffect(() => {
    if (!open) return;
    setViewDate(selected || new Date());
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const goMonth = (delta) => setViewDate(new Date(year, month + delta, 1));

  const pick = (d) => {
    onChange(toISO(d));
    setOpen(false);
  };

  const fmt = selected
    ? selected.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Seleccionar';

  return (
    <div className="cal-field" ref={wrapRef}>
      <button
        type="button"
        id={id}
        className="cal-field__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Calendar className="cal-field__icon" size={16} />
        {fmt}
      </button>

      {open && (
        <div className="cal-widget" role="dialog" aria-label={label || 'Selecciona una fecha'}>
          <div className="cal-widget__head">
            <span className="cal-widget__month">
              {MONTHS[month]} {year}
              <ChevronDown size={16} />
            </span>
            <div className="cal-widget__nav">
              <button type="button" onClick={() => goMonth(-1)} aria-label="Mes anterior">
                <ChevronLeft size={16} />
              </button>
              <button type="button" onClick={() => goMonth(1)} aria-label="Mes siguiente">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="cal-widget__weekdays">
            {WEEKDAYS.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>

          <div className="cal-widget__grid">
            {buildMonthGrid(year, month).map((d, i) => {
              const inMonth = d.getMonth() === month;
              const isToday = sameDay(d, today);
              const isSelected = sameDay(d, selected);
              return (
                <button
                  type="button"
                  key={i}
                  className={[
                    'cal-widget__day',
                    !inMonth && 'cal-widget__day--muted',
                    isToday && !isSelected && 'cal-widget__day--today',
                    isSelected && 'cal-widget__day--selected',
                  ].filter(Boolean).join(' ')}
                  disabled={!inMonth}
                  onClick={() => pick(d)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default CalendarWidget;
