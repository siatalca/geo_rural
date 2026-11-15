// Reportes del menu REPORTES (supervisor, secretaria y super): definicion de cada reporte,
// revision de la respuesta del servidor contra el contrato y hoja impresa.
// Logica pura (sin DOM). La hoja usa la misma envoltura carta horizontal de sin movimiento (M-026).
(function (root, factory) {
    const impresion = typeof module === 'object' && module.exports
        ? require('./sin-movimiento-impresion.js')
        : root.SiaSinMovimientoImpresion;
    const api = factory(impresion);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SiaReportes = api;
})(typeof window !== 'undefined' ? window : globalThis, function (impresion) {
    // eventColumn: nombre propio de FECHA EVENTO; null cuando repetiria FECHA INGRESO.
    const REPORTS = {
        ingresos: {
            title: 'DETALLE DE INGRESOS',
            description: 'Carpetas ingresadas en el rango, con su estado actual.',
            eventColumn: null
        },
        certificadas: {
            title: 'CERTIFICADAS POR EL SAG',
            description: 'Carpetas que pasaron a Certificada en el rango.',
            eventColumn: 'FECHA CERTIFICACIÓN'
        },
        'fuera-plazo': {
            title: 'PENDIENTES FUERA DE PLAZO',
            description: 'Carpetas con 15 días o más sin revisión, cuyo plazo empezó en el rango (ingreso o reingreso subsanado).',
            eventColumn: 'INICIO DEL PLAZO'
        },
        hallazgos: {
            title: 'CON HALLAZGOS',
            description: 'Carpetas con notificación de hallazgos en el rango.',
            eventColumn: 'FECHA HALLAZGO'
        }
    };
    const TYPES = Object.keys(REPORTS);
    const TEXT_FIELDS = ['numIngreso', 'nombre', 'rut', 'region', 'comuna', 'sucursal', 'estadoCarpeta', 'detalle'];

    function getReport(tipo) {
        return Object.prototype.hasOwnProperty.call(REPORTS, tipo) ? REPORTS[tipo] : null;
    }

    function columnsFor(tipo) {
        const report = getReport(tipo);
        const event = report && report.eventColumn ? [report.eventColumn] : [];
        return ['NRO INGRESO', 'FECHA INGRESO', ...event, 'NOMBRE', 'RUT', 'REGIÓN', 'COMUNA', 'SEDE', 'LOTES', 'ESTADO CARPETA', 'DETALLE'];
    }

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    // Fecha local AAAA-MM-DD (toISOString usaria UTC y de noche daria el dia siguiente).
    function toInputDate(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    // Rango por defecto: 1 de enero del año actual hasta hoy.
    function defaultRange(now = new Date()) {
        return { desde: `${now.getFullYear()}-01-01`, hasta: toInputDate(now) };
    }

    function parseDate(value) {
        const text = String(value ?? '').trim();
        if (!text) return null;
        const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (dateOnly) return { y: dateOnly[1], m: dateOnly[2], d: dateOnly[3] };
        const parsed = new Date(text.replace(' ', 'T'));
        if (Number.isNaN(parsed.getTime())) return null;
        return { y: String(parsed.getFullYear()), m: pad(parsed.getMonth() + 1), d: pad(parsed.getDate()) };
    }

    // Fecha ISO -> DD-MM-AAAA en hora local. Vacio si no es fecha.
    function formatDate(value) {
        const parts = parseDate(value);
        return parts ? `${parts.d}-${parts.m}-${parts.y}` : '';
    }

    function isCount(value) {
        return Number.isInteger(value) && value >= 0;
    }

    function isLotes(value) {
        if (value === null || value === '') return true;
        if (typeof value === 'number') return Number.isFinite(value);
        return typeof value === 'string' && /^\d+$/.test(value.trim());
    }

    // Revisa la respuesta contra el contrato. Devuelve { ok: true, data } o { ok: false, error }.
    function validateResponse(payload, tipo) {
        const fail = (detail) => ({ ok: false, error: `La respuesta del servidor no tiene el formato esperado (${detail}). No se puede mostrar ni imprimir el reporte.` });
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail('sin datos');
        if (payload.tipo !== tipo) return fail('tipo de reporte distinto');
        if (!parseDate(payload.desde) || !parseDate(payload.hasta)) return fail('rango de fechas');
        if (!payload.filtros || typeof payload.filtros !== 'object') return fail('filtros');
        if (!isCount(payload.total)) return fail('total');
        if (!Array.isArray(payload.resumen) || !Array.isArray(payload.registros)) return fail('resumen o registros');
        if (payload.total !== payload.registros.length) return fail('el total no calza con las carpetas');
        const badSummary = payload.resumen.some((item) => !item || typeof item.etiqueta !== 'string' || !isCount(item.cantidad));
        if (badSummary) return fail('resumen');
        const badRow = payload.registros.findIndex((row) => !row || typeof row !== 'object'
            || TEXT_FIELDS.some((field) => typeof row[field] !== 'string')
            || !parseDate(row.fechaIngreso) || !parseDate(row.fechaEvento) || !isLotes(row.numLotes));
        if (badRow >= 0) return fail(`carpeta ${badRow + 1}`);
        return { ok: true, data: payload };
    }

    function totalLabel(count) {
        return `${count} ${count === 1 ? 'carpeta' : 'carpetas'}`;
    }

    // Textos de cada fila en el orden de columnsFor(tipo).
    function rowCells(row, tipo) {
        const report = getReport(tipo);
        const event = report && report.eventColumn ? [formatDate(row.fechaEvento)] : [];
        return [row.numIngreso, formatDate(row.fechaIngreso), ...event, row.nombre, row.rut, row.region, row.comuna,
            row.sucursal, String(row.numLotes ?? ''), row.estadoCarpeta, row.detalle];
    }

    // filtros: { desde, hasta, region, sucursal } tal como los devolvio el servidor.
    function describeRange({ desde, hasta, region, sucursal }) {
        const parts = [`Desde: ${formatDate(desde)}`, `Hasta: ${formatDate(hasta)}`,
            `Región: ${String(region || '').trim() || 'Todas'}`, `Sede: ${String(sucursal || '').trim() || 'Todas'}`];
        return parts.join(' | ');
    }

    function describeSummary(resumen) {
        return (Array.isArray(resumen) ? resumen : []).map((item) => `${item.etiqueta}: ${item.cantidad}`).join(' | ');
    }

    const PRINT_CSS = '    .resumen { margin: 2pt 0 8pt; }';

    // data: respuesta ya validada por validateResponse.
    function buildPrintHtml({ tipo, data, printedAt }, escapeHtml) {
        const esc = (value) => escapeHtml(String(value ?? ''));
        const report = getReport(tipo);
        const columns = columnsFor(tipo);
        const head = `<tr>${columns.map((name) => `<th>${esc(name)}</th>`).join('')}</tr>`;
        const body = data.registros.length
            ? data.registros.map((row) => `<tr>${rowCells(row, tipo).map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${columns.length}" class="empty">Sin carpetas</td></tr>`;
        const filtros = data.filtros || {};
        const summary = describeSummary(data.resumen);
        const bodyHtml = `<h1>${esc(report.title)}</h1>
<p class="meta">Fecha de impresión: ${esc(printedAt)}</p>
<p class="meta">${esc(describeRange({ desde: data.desde, hasta: data.hasta, region: filtros.region, sucursal: filtros.sucursal }))}</p>
<p class="total">Total: ${esc(totalLabel(data.total))}</p>
${summary ? `<p class="meta resumen">Resumen: ${esc(summary)}</p>` : ''}
<table>
<thead>${head}</thead>
<tbody>${body}</tbody>
</table>`;
        return impresion.wrapPrintDocument(report.title, bodyHtml, escapeHtml, PRINT_CSS);
    }

    return { REPORTS, TYPES, getReport, columnsFor, defaultRange, parseDate, formatDate, validateResponse, totalLabel, rowCells,
        describeRange, describeSummary, buildPrintHtml };
});
