// Hojas impresas: seguimiento de carpetas sin movimiento (15 o mas dias, o en plazo) y BUSCAR POR FECHA.
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

    // NRO INGRESO «N-AAAA» -> { correlativo, anio }; null si no tiene ese formato (como parseNumIngreso del servidor).
    function parseNumIngreso(value) {
        const match = /^(\d+)-(\d{4})$/.exec(String(value ?? '').trim());
        return match ? { correlativo: Number(match[1]), anio: Number(match[2]) } : null;
    }

    // Orden de las hojas impresas: año ascendente y luego correlativo numérico ascendente (como compareNumIngreso
    // del servidor). Los números con otro formato van al final, ordenados como texto.
    function compareNumIngreso(left, right) {
        const a = parseNumIngreso(left);
        const b = parseNumIngreso(right);
        if (a && b) return a.anio - b.anio || a.correlativo - b.correlativo;
        if (a) return -1;
        if (b) return 1;
        return String(left ?? '').trim().localeCompare(String(right ?? '').trim(), 'es');
    }

    // Copia ordenada por NRO INGRESO (orden estable; no cambia la lista recibida). numOf: item -> NRO INGRESO.
    function sortByNumIngreso(items, numOf) {
        return (Array.isArray(items) ? items : []).slice().sort((left, right) => compareNumIngreso(numOf(left), numOf(right)));
    }

    // rows: [{ motivo, cells: [9 textos en el orden de COLUMNS] }]. Se agrupan por motivo (INGRESO si no es
    // REINGRESO SUBSANADA) y cada grupo va ordenado por NRO INGRESO. motivoOf y numOf permiten otra forma de fila.
    function groupBySection(rows, motivoOf = (row) => row?.motivo, numOf = (row) => row?.cells?.[0]) {
        const groups = { INGRESO: [], 'REINGRESO SUBSANADA': [] };
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const motivo = String(motivoOf(row) || '').trim().toUpperCase();
            groups[motivo === 'REINGRESO SUBSANADA' ? 'REINGRESO SUBSANADA' : 'INGRESO'].push(row);
        });
        return SECTIONS.map((name) => ({ name, rows: sortByNumIngreso(groups[name], numOf) }));
    }

    function buildPrintHtml({ title, printedAt, filters, rows }, escapeHtml) {
        const esc = (value) => escapeHtml(String(value ?? ''));
        const sections = groupBySection(rows);
        const total = sections.reduce((sum, section) => sum + section.rows.length, 0);
        const sectionHtml = sections.map((section) => buildSectionHtml(section.name, COLUMNS,
            section.rows.map((row) => COLUMNS.map((_, index) => row.cells?.[index])), escapeHtml)).join('\n');

        return wrapPrintDocument(title, `<h1>${esc(title)}</h1>
<p class="meta">Fecha de impresion: ${esc(printedAt)}</p>
<p class="meta">Filtros: ${esc(describeFilters(filters))}</p>
<p class="total">Total: ${esc(totalLabel(total))}</p>
${sectionHtml}
<p class="total-general">TOTAL GENERAL: ${esc(totalLabel(total))}</p>`, escapeHtml);
    }

    const DATE_RANGE_TITLE = 'BÚSQUEDA POR FECHA';
    // 14 columnas en carta horizontal: letra menor; solo el CORREO se corta en cualquier punto, para que nada se salga
    // sin partir los demas datos (RUT, numeros, encabezados).
    const DATE_RANGE_CSS = '    th, td { font-size: 7pt; padding: 2pt 3pt; }\n    th { font-size: 6.5pt; }\n'
        + '    td { overflow-wrap: break-word; }\n    td.correo { overflow-wrap: anywhere; }';

    // filters: { desde, hasta, sucursal, region, comuna } usados en la busqueda; vacio = TODAS.
    function describeDateRangeFilters(filters) {
        const f = filters || {};
        const all = (value) => String(value ?? '').trim() || 'TODAS';
        return [`Desde: ${formatFilterDate(f.desde)}`, `Hasta: ${formatFilterDate(f.hasta)}`, `Sucursal: ${all(f.sucursal)}`,
            `Region: ${all(f.region)}`, `Comuna: ${all(f.comuna)}`].join(' | ');
    }

    // Hoja de BUSCAR POR FECHA: todas las carpetas de la busqueda en una tabla ordenada por NRO INGRESO.
    // columns: encabezados (los del Excel para el rol actual). rowsOf(registrosOrdenados) -> [[textos por columna]].
    function buildDateRangePrintHtml({ printedAt, filters, columns, registros, rowsOf }, escapeHtml) {
        const esc = (value) => escapeHtml(String(value ?? ''));
        const sorted = sortByNumIngreso(registros, (row) => row?.numIngreso);
        const cellRows = sorted.length ? rowsOf(sorted) : [];
        const head = `<tr>${columns.map((column) => `<th>${esc(column)}</th>`).join('')}</tr>`;
        const body = cellRows.length
            ? cellRows.map((cells) => `<tr>${columns.map((column, index) =>
                `<td${column === 'CORREO' ? ' class="correo"' : ''}>${esc(cells[index])}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${columns.length}" class="empty">Sin carpetas</td></tr>`;
        return wrapPrintDocument(DATE_RANGE_TITLE, `<h1>${esc(DATE_RANGE_TITLE)}</h1>
<p class="meta">Fecha de impresión: ${esc(printedAt)}</p>
<p class="meta">${esc(describeDateRangeFilters(filters))}</p>
<p class="total">Total: ${esc(totalLabel(sorted.length))}</p>
<table>
<thead>${head}</thead>
<tbody>${body}</tbody>
</table>`, escapeHtml, DATE_RANGE_CSS);
    }

    // Seccion con titulo, tabla y subtotal. cellRows: [[textos en el orden de columns]], se escapan aqui.
    // Tambien la usa el DETALLE DE INGRESOS de los reportes (M-028).
    function buildSectionHtml(name, columns, cellRows, escapeHtml) {
        const esc = (value) => escapeHtml(String(value ?? ''));
        const head = `<tr>${columns.map((column) => `<th>${esc(column)}</th>`).join('')}</tr>`;
        const body = cellRows.length
            ? cellRows.map((cells) => `<tr>${cells.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${columns.length}" class="empty">Sin carpetas</td></tr>`;
        return `<h2>${esc(name)}</h2>
<table>
<thead>${head}</thead>
<tbody>${body}</tbody>
</table>
<p class="subtotal">Subtotal ${esc(name)}: ${esc(totalLabel(cellRows.length))}</p>`;
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

    return { COLUMNS, SECTIONS, totalLabel, describeFilters, parseNumIngreso, compareNumIngreso, sortByNumIngreso, groupBySection,
        describeDateRangeFilters, buildDateRangePrintHtml, buildSectionHtml, buildPrintHtml, wrapPrintDocument };
});
