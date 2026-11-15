// Hoja impresa del seguimiento de carpetas sin movimiento (15 o mas dias, o en plazo).
// Logica pura (sin DOM): arma el HTML que script.js imprime con openSolicitudPrintFrame.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SiaSinMovimientoImpresion = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const COLUMNS = ['NRO INGRESO', 'FECHA INGRESO', 'DIAS', 'MOTIVO', 'NOMBRE', 'RUT', 'SUCURSAL', 'REGION', 'COMUNA'];
    const SECTIONS = ['INGRESO', 'REINGRESO SUBSANADA'];

    function totalLabel(count) {
        return `${count} ${count === 1 ? 'carpeta' : 'carpetas'}`;
    }

    // AAAA-MM-DD -> DD-MM-AAAA; cualquier otro texto se deja igual.
    function formatFilterDate(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
        return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value || '').trim();
    }

    // filters: { region, comuna, sucursal, desde, hasta } con los valores aplicados en la ventana.
    function describeFilters(filters) {
        const f = filters || {};
        const parts = [
            ['Region', f.region],
            ['Comuna', f.comuna],
            ['Sucursal', f.sucursal],
            ['Desde fecha ingreso', formatFilterDate(f.desde)],
            ['Hasta fecha ingreso', formatFilterDate(f.hasta)]
        ].filter(([, value]) => String(value || '').trim());
        return parts.length ? parts.map(([label, value]) => `${label}: ${String(value).trim()}`).join(' | ') : 'Sin filtros';
    }

    // rows: [{ motivo, cells: [9 textos en el orden de COLUMNS] }]. Se agrupan por motivo.
    function groupBySection(rows) {
        const groups = { INGRESO: [], 'REINGRESO SUBSANADA': [] };
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const motivo = String(row?.motivo || '').trim().toUpperCase();
            groups[motivo === 'REINGRESO SUBSANADA' ? 'REINGRESO SUBSANADA' : 'INGRESO'].push(row);
        });
        return SECTIONS.map((name) => ({ name, rows: groups[name] }));
    }

    function buildPrintHtml({ title, printedAt, filters, rows }, escapeHtml) {
        const esc = (value) => escapeHtml(String(value ?? ''));
        const sections = groupBySection(rows);
        const total = sections.reduce((sum, section) => sum + section.rows.length, 0);
        const head = `<tr>${COLUMNS.map((name) => `<th>${esc(name)}</th>`).join('')}</tr>`;
        const sectionHtml = sections.map((section) => {
            const body = section.rows.length
                ? section.rows.map((row) => `<tr>${COLUMNS.map((_, index) => `<td>${esc(row.cells?.[index])}</td>`).join('')}</tr>`).join('')
                : `<tr><td colspan="${COLUMNS.length}" class="empty">Sin carpetas</td></tr>`;
            return `<h2>${esc(section.name)}</h2>
<table>
<thead>${head}</thead>
<tbody>${body}</tbody>
</table>
<p class="subtotal">Subtotal ${esc(section.name)}: ${esc(totalLabel(section.rows.length))}</p>`;
        }).join('\n');

        return wrapPrintDocument(title, `<h1>${esc(title)}</h1>
<p class="meta">Fecha de impresion: ${esc(printedAt)}</p>
<p class="meta">Filtros: ${esc(describeFilters(filters))}</p>
<p class="total">Total: ${esc(totalLabel(total))}</p>
${sectionHtml}
<p class="total-general">TOTAL GENERAL: ${esc(totalLabel(total))}</p>`, escapeHtml);
    }

    // Documento carta horizontal con encabezado de tabla repetido en cada hoja. bodyHtml ya viene escapado.
    // extraCss agrega reglas propias de otra hoja (por ejemplo, los reportes) sin cambiar esta.
    function wrapPrintDocument(title, bodyHtml, escapeHtml, extraCss = '') {
        const esc = (value) => escapeHtml(String(value ?? ''));
        return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
    @page { size: letter landscape; margin: 1.2cm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #000; }
    h1 { font-size: 13pt; margin: 0 0 4pt; }
    h2 { font-size: 10.5pt; margin: 12pt 0 4pt; break-after: avoid; page-break-after: avoid; }
    .meta { margin: 0 0 2pt; }
    .total { font-weight: 700; margin: 4pt 0 0; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td { border: 1px solid #555; padding: 3pt 4pt; text-align: left; vertical-align: top; }
    th { background: #e3e3e3; font-size: 8pt; }
    td.empty { text-align: center; font-style: italic; }
    .subtotal { font-weight: 700; margin: 4pt 0 0; text-align: right; }
    .total-general { font-weight: 700; font-size: 10.5pt; margin: 14pt 0 0; text-align: right; border-top: 2px solid #000; padding-top: 4pt; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${extraCss ? `${extraCss}\n` : ''}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
    }

    return { COLUMNS, totalLabel, describeFilters, groupBySection, buildPrintHtml, wrapPrintDocument };
});
