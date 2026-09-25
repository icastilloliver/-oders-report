/* ─────────────────── Reporte PDF del Historial ───────────────────
 * Genera un PDF ejecutivo (A4 horizontal) con: encabezado de marca,
 * KPIs del rango (Plan A / Plan B / Error), la gráfica de distribución
 * diaria TAL CUAL se ve en pantalla (con carriles y globos de
 * incidencias), la clave de incidencias con su detalle y la tabla
 * diaria de porcentajes. jsPDF se importa perezoso: no pesa en el
 * bundle inicial. */

const M = 14; // margen (mm)
const ANCHO = 297; // A4 horizontal
const ALTO = 210;

const fmtNum = (n) => n.toLocaleString('es-MX');

/* La Helvetica embebida de jsPDF no trae '→': se sustituye por '-' para
   que no salga basura en el PDF. */
const limpiar = (t) => String(t ?? '').replace(/→/g, '-');
const fmtPct = (n) => `${n.toFixed(2).replace(/\.?0+$/, '')}%`;

const hexARgb = (hex) => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

export async function generarReportePdf({
  tituloCompania,
  rangeLabel,
  filtrosTexto,
  data,
  incidents,
  colorDeIncidencia,
  chartCanvas,
  brandColor,
}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const marca = hexARgb(brandColor || '#833177');

  const totales = data.reduce(
    (a, d) => ({
      total: a.total + d.Total,
      a: a.a + d.Plan_A,
      b: a.b + d.Plan_B,
      e: a.e + d.Error,
    }),
    { total: 0, a: 0, b: 0, e: 0 }
  );
  const pct = (n) => (totales.total ? (n / totales.total) * 100 : 0);

  let pagina = 1;
  const pie = () => {
    doc.setFontSize(7.5);
    doc.setTextColor(150);
    doc.text(
      `Generado el ${new Date().toLocaleString('es-MX')} · Fecha Estimada de Entrega · página ${pagina}`,
      ANCHO / 2,
      ALTO - 6,
      { align: 'center' }
    );
  };
  const nuevaPagina = () => {
    pie();
    doc.addPage();
    pagina += 1;
    return M + 4;
  };

  /* ── Encabezado de marca ── */
  doc.setFillColor(...marca);
  doc.rect(0, 0, ANCHO, 22, 'F');
  doc.setTextColor(255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(`Reporte de Remisiones · ${tituloCompania}`, M, 10);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(limpiar(`Rango: ${rangeLabel}${filtrosTexto ? `   ·   Filtros: ${filtrosTexto}` : ''}`), M, 17);

  /* ── KPIs ── */
  let y = 30;
  const kpis = [
    ['Total de registros', fmtNum(totales.total), null],
    ['Plan A', `${fmtNum(totales.a)}  ·  ${fmtPct(pct(totales.a))}`, '#ac75a4'],
    ['Plan B', `${fmtNum(totales.b)}  ·  ${fmtPct(pct(totales.b))}`, '#f0b133'],
    ['Error', `${fmtNum(totales.e)}  ·  ${fmtPct(pct(totales.e))}`, '#ff3333'],
  ];
  const kw = (ANCHO - 2 * M - 3 * 6) / 4;
  kpis.forEach(([label, valor, color], i) => {
    const x = M + i * (kw + 6);
    doc.setDrawColor(225);
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(x, y, kw, 20, 2, 2, 'FD');
    if (color) {
      doc.setFillColor(...hexARgb(color));
      doc.rect(x, y, kw, 1.6, 'F');
    }
    doc.setTextColor(110);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(label.toUpperCase(), x + 4, y + 7);
    doc.setTextColor(30);
    doc.setFontSize(12.5);
    doc.setFont('helvetica', 'bold');
    doc.text(valor, x + 4, y + 15);
  });

  /* ── Gráfica (tal cual se ve, con carriles de incidencias) ── */
  y += 27;
  doc.setTextColor(30);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Distribución diaria por plan', M, y);
  y += 3;
  if (chartCanvas) {
    // Fondo blanco (el canvas es transparente) para que el PDF no salga negro
    const tmp = document.createElement('canvas');
    tmp.width = chartCanvas.width;
    tmp.height = chartCanvas.height;
    const cx = tmp.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, tmp.width, tmp.height);
    cx.drawImage(chartCanvas, 0, 0);
    const img = tmp.toDataURL('image/png');
    const w = ANCHO - 2 * M;
    const h = Math.min((tmp.height / tmp.width) * w, 92);
    doc.addImage(img, 'PNG', M, y, w, h);
    y += h + 6;
  }

  /* ── Timeline de incidencias ── */
  if (incidents.length > 0) {
    if (y > ALTO - 45) y = nuevaPagina();
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30);
    doc.text('Timeline de incidencias', M, y);
    y += 6;

    const TIPOS = { PLAN_B: 'Plan B', ERROR: 'Error', AMBOS: 'Plan B + Error' };
    incidents.forEach((inc, i) => {
      const desc = inc.descripcion
        ? doc.splitTextToSize(limpiar(inc.descripcion), ANCHO - 2 * M - 14)
        : [];
      const alto = 11 + desc.length * 3.6;
      if (y + alto > ALTO - 14) y = nuevaPagina();

      // globo numerado con el color del evento
      const color = hexARgb(colorDeIncidencia(inc));
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...color);
      doc.setLineWidth(0.7);
      doc.circle(M + 3.4, y + 1.6, 3.2, 'FD');
      doc.setTextColor(60);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(String(i + 1), M + 3.4, y + 2.8, { align: 'center' });

      const horario =
        inc.horaInicio === null || inc.horaInicio === undefined
          ? 'Todo el día'
          : `${String(inc.horaInicio).padStart(2, '0')}:00 - ${String(inc.horaFin).padStart(2, '0')}:59`;
      const rango = inc.fechaFin ? `${inc.fecha} - ${inc.fechaFin}` : inc.fecha;

      doc.setTextColor(30);
      doc.setFontSize(9.5);
      doc.text(limpiar(inc.titulo), M + 10, y + 1.8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120);
      doc.setFontSize(8);
      doc.text(`${rango}   ·   ${horario}   ·   Afecta: ${TIPOS[inc.tipo] || inc.tipo}`, M + 10, y + 6.2);
      if (desc.length) {
        doc.setTextColor(80);
        doc.text(desc, M + 10, y + 10.4);
      }
      y += alto;
    });
  }

  /* ── Tabla diaria de porcentajes ── */
  if (y > ALTO - 40) y = nuevaPagina();
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30);
  doc.text('Detalle diario (%)', M, y);
  y += 6;

  const cols = [
    ['Fecha', 26],
    ['Total', 24],
    ['Plan A', 22],
    ['% A', 18],
    ['Plan B', 22],
    ['% B', 18],
    ['Error', 22],
    ['% E', 18],
  ];
  const encabezado = () => {
    doc.setFillColor(...marca);
    doc.rect(M, y - 4, cols.reduce((a, c) => a + c[1], 0), 6, 'F');
    doc.setTextColor(255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    let x = M + 2;
    cols.forEach(([nombre, ancho]) => {
      doc.text(nombre, x, y);
      x += ancho;
    });
    y += 5.4;
  };
  encabezado();

  doc.setFont('helvetica', 'normal');
  data.forEach((d, i) => {
    if (y > ALTO - 14) {
      y = nuevaPagina() + 2;
      encabezado();
      doc.setFont('helvetica', 'normal');
    }
    if (i % 2 === 1) {
      doc.setFillColor(246, 246, 249);
      doc.rect(M, y - 3.6, cols.reduce((a, c) => a + c[1], 0), 5, 'F');
    }
    const p = (n) => (d.Total ? (n / d.Total) * 100 : 0);
    const fila = [
      d.Fecha,
      fmtNum(d.Total),
      fmtNum(d.Plan_A),
      fmtPct(p(d.Plan_A)),
      fmtNum(d.Plan_B),
      fmtPct(p(d.Plan_B)),
      fmtNum(d.Error),
      fmtPct(p(d.Error)),
    ];
    doc.setTextColor(50);
    doc.setFontSize(7.8);
    let x = M + 2;
    fila.forEach((valor, j) => {
      doc.text(String(valor), x, y);
      x += cols[j][1];
    });
    y += 5;
  });

  pie();
  return doc;
}
