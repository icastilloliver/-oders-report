import CalendarWidget from './CalendarWidget.jsx';

/* ─────────────────── Rango de fechas estándar ───────────────────
 * Par Desde/Hasta EXACTAMENTE como en los filtros del Historial de
 * Remisiones: .field + CalendarWidget (el organism del sistema de
 * diseño). Es EL date picker del proyecto — cualquier vista nueva
 * debe usar este componente, nunca un <input type="date"> nativo. */

function DateRange({
  startId = 'range-start',
  endId = 'range-end',
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  startLabel = 'Desde',
  endLabel = 'Hasta',
}) {
  return (
    <>
      <div className="field">
        <label htmlFor={startId}>{startLabel}</label>
        <CalendarWidget
          id={startId}
          value={startDate}
          onChange={onStartChange}
          label={`Fecha ${startLabel.toLowerCase()}`}
        />
      </div>

      <div className="field">
        <label htmlFor={endId}>{endLabel}</label>
        <CalendarWidget
          id={endId}
          value={endDate}
          onChange={onEndChange}
          label={`Fecha ${endLabel.toLowerCase()}`}
        />
      </div>
    </>
  );
}

export default DateRange;
