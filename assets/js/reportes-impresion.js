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
    // Valores de registros[].facturacion y etiquetas de resumenFacturacion (solo en «ingresos»).
    const BILLING_STATES = ['FACTURADA', 'PENDIENTE DE FACTURAR', 'SIN SOLICITAR'];
    // Valores de registros[].motivo (solo en «fuera-plazo»), en el orden de las secciones de la hoja.
    const FUERA_PLAZO_MOTIVOS = impresion.SECTIONS;
    const TEXT_FIELDS =['numIngreso', 'nombre', 'rut', 'region', 'comuna', 'sucursal', 'estadoCarpeta', 'detalle'];

    function getReport(tipo) {
        return Object.prototype.hasOwnProperty.call(REPORTS, tipo) ? REPORTS[tipo] : null;
    }

    function columnsFor(tipo) {
        const report = getReport(tipo);
        const event = report && report.eventColumn ? [report.eventColumn] : [];
        const billing = tipo === 'ingresos' ? ['FACTURACIÓN', 'NRO FACTURA', 'MONTO A FACTURAR'] : [];
        return ['NRO INGRESO', 'FECHA INGRESO', ...event, 'NOMBRE', 'RUT', 'REGIÓN', 'COMUNA', 'SEDE', 'LOTES', 'ESTADO CARPETA',
            ...billing, 'DETALLE'];
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

    function isAmount(value) {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
        if (tipo === 'ingresos') {
            const billing = payload.resumenFacturacion;
            if (!Array.isArray(billing) || billing.length !== BILLING_STATES.length
                || billing.some((item) => !item || !BILLING_STATES.includes(item.etiqueta) || !isCount(item.cantidad))
                || new Set(billing.map((item) => item.etiqueta)).size !== BILLING_STATES.length) {
                return fail('resumen de facturación');
            }
            if (billing.reduce((sum, item) => sum + item.cantidad, 0) !== payload.total) {
                return fail('la facturación no calza con el total');
            }
            // monto puede no venir (rol sin acceso a montos), pero entonces no viene en ninguna clase.
            const withAmount = billing.filter((item) => Object.prototype.hasOwnProperty.call(item, 'monto') && item.monto !== null);
            if (withAmount.length && (withAmount.length !== billing.length || !withAmount.every((item) => isAmount(item.monto)))) {
                return fail('montos de facturación');
            }
            const badBilling = payload.registros.findIndex((row) => !BILLING_STATES.includes(row.facturacion)
                || typeof row.facturaNumero !== 'string' || !(row.facturaMonto === null || isAmount(row.facturaMonto)));
            if (badBilling >= 0) return fail(`facturación de la carpeta ${badBilling + 1}`);
        }
        if (tipo === 'fuera-plazo') {
            // La hoja se separa por motivo: cada carpeta debe traer INGRESO o REINGRESO SUBSANADA.
            const badMotivo = payload.registros.findIndex((row) => !FUERA_PLAZO_MOTIVOS.includes(row.motivo));
            if (badMotivo >= 0) return fail(`motivo de la carpeta ${badMotivo + 1}`);
        }
        return { ok: true, data: payload };
    }

    function totalLabel(count) {
        return `${count} ${count === 1 ? 'carpeta' : 'carpetas'}`;
    }

    // Textos de cada fila en el orden de columnsFor(tipo).
    function rowCells(row, tipo) {
        const report = getReport(tipo);
        const event = report && report.eventColumn ? [formatDate(row.fechaEvento)] : [];
        const billing = tipo === 'ingresos'
            ? [row.facturacion, row.facturaNumero, row.facturaMonto === null || row.facturaMonto === undefined ? '' : formatPesos(row.facturaMonto)]
            : [];
        return [row.numIngreso, formatDate(row.fechaIngreso), ...event, row.nombre, row.rut, row.region, row.comuna,
            row.sucursal, String(row.numLotes ?? ''), row.estadoCarpeta, ...billing, row.detalle];
    }

    // Pesos chilenos como en el resto del sistema (formatInvoiceAmount de script.js): «$ 1.234.567», hasta 2 decimales.
    // Aqui 0 se muestra «$ 0» (un subtotal en cero es un dato, no un monto faltante).
    function formatPesos(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return '';
        return `$ ${parsed.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    }

    // true si el resumen trae monto en cada clase (validateResponse ya exige todas o ninguna).
    function billingHasAmounts(resumenFacturacion) {
        const items = Array.isArray(resumenFacturacion) ? resumenFacturacion : [];
        return items.length > 0 && items.every((item) => isAmount(item?.monto));
    }

    // Una clase: «FACTURADA: 2 ($ 1.500.000)»; sin montos, «FACTURADA: 2».
    function billingItemLabel(item, withAmounts) {
        return `${item.etiqueta}: ${item.cantidad}${withAmounts ? ` (${formatPesos(item.monto)})` : ''}`;
    }

    // Las 3 clases en el orden que trae el servidor, separadas por « | ».
    function describeBilling(resumenFacturacion) {
        const items = Array.isArray(resumenFacturacion) ? resumenFacturacion : [];
        const withAmounts = billingHasAmounts(items);
        return items.map((item) => billingItemLabel(item, withAmounts)).join(' | ');
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
    const INGRESOS_CSS = `${PRINT_CSS}\n    .facturacion { margin: 0 0 8pt; }\n    .sin-carpetas { margin: 0 0 4pt; font-style: italic; }`
        // 13 columnas en carta horizontal: letra un poco menor y corte de palabras largas para que nada se salga.
        + '\n    th, td { font-size: 7.5pt; padding: 2pt 3pt; overflow-wrap: break-word; }\n    th { font-size: 7pt; }';
    const SIN_ESTADO = 'Sin estado';
    const CERTIFICADA = 'Certificada';

    // Clave para comparar estados: sin tildes, mayusculas y espacios simples ("Certificada" = "CERTIFICADA").
    function statusKey(value) {
        return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[\s_]+/g, ' ').trim().toUpperCase();
    }

    // Etiquetas del catalogo de estado de carpeta en el orden del selector ESTADO CARPETA: por grupo (orden de
    // groups) y dentro de cada grupo en el orden de options. groups: [{ id }]; options: [{ label, groupId }].
    function catalogLabels(groups, options) {
        const groupIds = (Array.isArray(groups) ? groups : []).map((group) => group?.id);
        const position = (option) => {
            const index = groupIds.indexOf(option?.groupId);
            return index >= 0 ? index : groupIds.length;
        };
        return (Array.isArray(options) ? options : [])
            .map((option, index) => ({ option, index }))
            .sort((a, b) => position(a.option) - position(b.option) || a.index - b.index)
            .map(({ option }) => String(option?.label ?? '').trim())
            .filter(Boolean);
    }

    // Grupos del DETALLE DE INGRESOS: «Sin estado», «Certificada», los del catalogo en su orden y al final los
    // estados que no estan en el catalogo (en el orden en que aparecen). estados: etiquetas del catalogo en orden;
    // si no es una lista con etiquetas, solo se agrupan los estados presentes.
    // Devuelve [{ name, rows, compact }]; compact = estado del catalogo sin carpetas en el rango.
    function groupByStatus(registros, estados) {
        const catalog = (Array.isArray(estados) ? estados : [])
            .map((label) => String(label ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
        const hasCatalog = catalog.length > 0;
        const groups = new Map();
        const addGroup = (name, fromCatalog) => {
            const key = statusKey(name);
            if (!key || groups.has(key)) return;
            groups.set(key, { name, rows: [], fromCatalog });
        };
        const certificadaLabel = catalog.find((label) => statusKey(label) === statusKey(CERTIFICADA)) || CERTIFICADA;
        addGroup(SIN_ESTADO, hasCatalog);
        addGroup(certificadaLabel, hasCatalog);
        catalog.forEach((label) => addGroup(label, true));
        (Array.isArray(registros) ? registros : []).forEach((row) => {
            const label = String(row?.estadoCarpeta ?? '').replace(/\s+/g, ' ').trim() || SIN_ESTADO;
            addGroup(label, false);
            groups.get(statusKey(label)).rows.push(row);
        });
        return Array.from(groups.values())
            .filter((group) => group.rows.length > 0 || group.fromCatalog)
            .map(({ name, rows }) => ({ name, rows, compact: rows.length === 0 }));
    }

    function ingresosSectionsHtml(data, estados, escapeHtml) {
        const esc = (value) => escapeHtml(String(value ?? ''));
        const columns = columnsFor('ingresos');
        const sections = groupByStatus(data.registros, estados).map((group) => (group.compact
            ? `<h2>${esc(group.name)}</h2>\n<p class="sin-carpetas">Sin carpetas: 0</p>`
            : impresion.buildSectionHtml(group.name, columns, sortRows(group.rows).map((row) => rowCells(row, 'ingresos')), escapeHtml)));
        return `${sections.join('\n')}
<p class="total-general">TOTAL GENERAL: ${esc(totalLabel(data.registros.length))}</p>`;
    }

    // Copia de las carpetas ordenada por NRO INGRESO (año y correlativo), como las demas hojas impresas.
    function sortRows(registros) {
        return impresion.sortByNumIngreso(registros, (row) => row?.numIngreso);
    }

    // PENDIENTES FUERA DE PLAZO: INGRESO y REINGRESO SUBSANADA (registros[].motivo), como la hoja de sin movimiento.
    function fueraPlazoSectionsHtml(data, escapeHtml) {
        const esc = (value) => escapeHtml(String(value ?? ''));
        const columns = columnsFor('fuera-plazo');
        const sections = impresion.groupBySection(data.registros, (row) => row?.motivo, (row) => row?.numIngreso)
            .map((section) => impresion.buildSectionHtml(section.name, columns,
                section.rows.map((row) => rowCells(row, 'fuera-plazo')), escapeHtml));
        return `${sections.join('\n')}
<p class="total-general">TOTAL GENERAL: ${esc(totalLabel(data.registros.length))}</p>`;
    }

    // data: respuesta ya validada por validateResponse. estados: etiquetas del catalogo de estado de carpeta en
    // orden (solo para «ingresos», que se imprime agrupado por estado). «fuera-plazo» va en 2 tablas por motivo y
    // los otros reportes en una sola tabla. Toda tabla va ordenada por NRO INGRESO.
    function buildPrintHtml({ tipo, data, printedAt, estados }, escapeHtml) {
        const esc = (value) => escapeHtml(String(value ?? ''));
        const report = getReport(tipo);
        const columns = columnsFor(tipo);
        const head = `<tr>${columns.map((name) => `<th>${esc(name)}</th>`).join('')}</tr>`;
        const body = data.registros.length
            ? sortRows(data.registros).map((row) =>`<tr>${rowCells(row, tipo).map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${columns.length}" class="empty">Sin carpetas</td></tr>`;
        const filtros = data.filtros || {};
        const summary = describeSummary(data.resumen);
        const detail = tipo === 'ingresos'
            ? ingresosSectionsHtml(data, estados, escapeHtml)
            : tipo === 'fuera-plazo'
                ? fueraPlazoSectionsHtml(data, escapeHtml)
                : `<table>
<thead>${head}</thead>
<tbody>${body}</tbody>
</table>`;
        const bodyHtml = `<h1>${esc(report.title)}</h1>
<p class="meta">Fecha de impresión: ${esc(printedAt)}</p>
<p class="meta">${esc(describeRange({ desde: data.desde, hasta: data.hasta, region: filtros.region, sucursal: filtros.sucursal }))}</p>
<p class="total">Total: ${esc(totalLabel(data.total))}</p>
${summary ? `<p class="meta resumen">Resumen: ${esc(summary)}</p>` : ''}
${tipo === 'ingresos' ? `<p class="meta facturacion">Facturación: ${esc(describeBilling(data.resumenFacturacion))}</p>\n` : ''}${detail}`;
        return impresion.wrapPrintDocument(report.title, bodyHtml, escapeHtml, tipo === 'ingresos' ? INGRESOS_CSS : PRINT_CSS);
    }

    return { REPORTS, TYPES, getReport, columnsFor, defaultRange, parseDate, formatDate, validateResponse, totalLabel, rowCells,
        describeRange, describeSummary, describeBilling, billingHasAmounts, billingItemLabel, formatPesos, BILLING_STATES, FUERA_PLAZO_MOTIVOS, statusKey, catalogLabels, groupByStatus, buildPrintHtml };
});
