const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const impresion = require('../assets/js/sin-movimiento-impresion.js');

// Carga las funciones reales de permiso por rol desde script.js (cliente).
function loadClientRoleFunctions() {
    const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
    const names = ['normalizeUserRole', 'isAdminUser', 'isSuperUser', 'isSecretaryUser', 'isOperatorUser', 'isSupervisorUser',
        'isContadorUser', 'isGuestUser', 'canUseSecretaryFeatures', 'canUseNoMovementFollowup', 'canPrintNoMovementReport'];
    const code = names.map((name) => {
        const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
        assert.ok(match, `Función real ${name}`);
        return match[0];
    }).join('\n');
    const context = {};
    vm.runInNewContext(code, context);
    return context;
}

const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

test('botones IMPRIMIR y CARPETAS EN PLAZO: solo supervisor, super y secretaria', () => {
    const c = loadClientRoleFunctions();
    const roles = ['SUPERVISOR', 'SUPER', 'SECRETARIA', 'ADMIN', 'OPERADOR', 'CONTADOR'];
    assert.deepEqual(roles.map((role) => c.canPrintNoMovementReport({ role, username: 'x' })), [true, true, true, false, false, false]);
    // ADMIN y OPERADOR siguen viendo la ventana.
    assert.deepEqual(roles.map((role) => c.canUseNoMovementFollowup({ role, username: 'x' })), [true, true, true, true, true, false]);
    assert.equal(c.canPrintNoMovementReport({ role: 'SECRETARIA', isGuest: true }), false);
    assert.equal(c.canPrintNoMovementReport(null), false);
});

test('filtros de la hoja: legibles o «Sin filtros»', () => {
    assert.equal(impresion.describeFilters({}), 'Sin filtros');
    assert.equal(impresion.describeFilters({ region: 'MAULE', comuna: '', sucursal: 'TALCA', desde: '2026-10-01', hasta: '' }),
        'Region: MAULE | Sucursal: TALCA | Desde fecha ingreso: 01-10-2026');
});

test('la hoja separa INGRESO y REINGRESO SUBSANADA con subtotales y total general', () => {
    const rows = [
        { motivo: 'INGRESO', cells: ['A-1', '01-10-2026', '20', 'INGRESO', 'Ana <b>', '1-9', 'TALCA', 'MAULE', 'TALCA'] },
        { motivo: 'INGRESO', cells: ['A-2', '02-10-2026', '19', 'INGRESO', 'Luis', '2-7', 'TALCA', 'MAULE', 'CUREPTO'] },
        { motivo: 'REINGRESO SUBSANADA', cells: ['A-3', '03-09-2026', '16', 'REINGRESO SUBSANADA', 'Eva', '3-5', 'LINARES', 'MAULE', 'LINARES'] }
    ];
    const html = impresion.buildPrintHtml({ title: 'SEGUIMIENTO DE REGISTROS SIN MOVIMIENTO', printedAt: '14-11-2026 10:00', filters: {}, rows }, escapeHtml);
    assert.match(html, /@page \{ size: letter landscape/);
    assert.match(html, /thead \{ display: table-header-group; \}/);
    assert.match(html, /Filtros: Sin filtros/);
    assert.match(html, /Total: 3 carpetas/);
    assert.match(html, /Subtotal INGRESO: 2 carpetas/);
    assert.match(html, /Subtotal REINGRESO SUBSANADA: 1 carpeta</);
    assert.match(html, /TOTAL GENERAL: 3 carpetas/);
    assert.match(html, /Ana &lt;b&gt;/);
    assert.doesNotMatch(html, /Ana <b>/);
    for (const column of impresion.COLUMNS) assert.ok(html.includes(`<th>${column}</th>`), column);
});

test('una sección vacía se imprime con «Sin carpetas» y subtotal 0', () => {
    const rows = [{ motivo: 'INGRESO', cells: ['A-1', '', '3', 'INGRESO', '', '', '', '', ''] }];
    const html = impresion.buildPrintHtml({ title: 'X', printedAt: '', filters: {}, rows }, escapeHtml);
    assert.match(html, /Sin carpetas/);
    assert.match(html, /Subtotal REINGRESO SUBSANADA: 0 carpetas/);
    assert.match(html, /TOTAL GENERAL: 1 carpeta</);
});

// --- M-031: hojas impresas ordenadas por NRO INGRESO (año y luego correlativo) ---

const cellsOf = (html) => [...html.matchAll(/<tr><td>([^<]*)<\/td>/g)].map((m) => m[1]);

test('orden por NRO INGRESO: año ascendente, luego correlativo numérico; formatos raros al final como texto', () => {
    const numeros = ['10-2026', '1-2026', 'sin número', '89-2025', '2-2026', '100-2026', '', 'A-7', ' 3-2026 ', '5-2024',
        '12-26', '9-2025'];
    const ordenados = numeros.slice().sort(impresion.compareNumIngreso);
    assert.deepEqual(ordenados, ['5-2024', '9-2025', '89-2025', '1-2026', '2-2026', ' 3-2026 ', '10-2026', '100-2026',
        '', '12-26', 'A-7', 'sin número']);
    assert.ok(impresion.compareNumIngreso('2-2026', '10-2026') < 0, '2 antes que 10 (no como texto)');
    assert.ok(impresion.compareNumIngreso('89-2025', '1-2026') < 0, 'el año manda');
    assert.ok(impresion.compareNumIngreso('99-2026', 'X-1') < 0, 'válido antes que formato raro');
    assert.equal(impresion.compareNumIngreso('7-2026', '007-2026'), 0);
    assert.equal(impresion.compareNumIngreso(null, undefined), 0);
    assert.deepEqual(impresion.parseNumIngreso(' 45-2026 '), { correlativo: 45, anio: 2026 });
    assert.equal(impresion.parseNumIngreso('45-2026-VII'), null);
});

test('ordenar no cambia la lista recibida y es estable con números repetidos', () => {
    const lista = [{ n: '2-2026', id: 'a' }, { n: '1-2026', id: 'b' }, { n: '2-2026', id: 'c' }];
    const copia = JSON.stringify(lista);
    assert.deepEqual(impresion.sortByNumIngreso(lista, (item) => item.n).map((item) => item.id), ['b', 'a', 'c']);
    assert.equal(JSON.stringify(lista), copia);
    assert.deepEqual(impresion.sortByNumIngreso(null, (item) => item), []);
});

test('sin movimiento impreso: cada tabla (INGRESO y REINGRESO SUBSANADA) va ordenada por NRO INGRESO', () => {
    const fila = (num, motivo) => ({ motivo, cells: [num, '', '20', motivo, 'X', '', '', '', ''] });
    const rows = [fila('10-2026', 'INGRESO'), fila('3-2026', 'REINGRESO SUBSANADA'), fila('2-2026', 'INGRESO'),
        fila('raro', 'INGRESO'), fila('89-2025', 'INGRESO'), fila('1-2025', 'REINGRESO SUBSANADA'), fila('1-2026', 'INGRESO')];
    const html = impresion.buildPrintHtml({ title: 'CARPETAS EN PLAZO', printedAt: 'x', filters: {}, rows }, escapeHtml);
    const [ingreso, reingreso] = html.split('<h2>REINGRESO SUBSANADA</h2>');
    assert.deepEqual(cellsOf(ingreso), ['89-2025', '1-2026', '2-2026', '10-2026', 'raro']);
    assert.deepEqual(cellsOf(reingreso), ['1-2025', '3-2026']);
    assert.match(html, /Subtotal INGRESO: 5 carpetas/);
    assert.match(html, /TOTAL GENERAL: 7 carpetas/);
    assert.equal(rows[0].cells[0], '10-2026', 'no reordena la lista de la ventana');
});

// --- M-031: IMPRIMIR de BUSCAR POR FECHA ---

// Carga las funciones reales de script.js que arman columnas, filas e impresión de BUSCAR POR FECHA.
function loadDateRangePrint(currentUser, dateRangeMatches, dateRangeSearchFilters = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
    const names = ['normalizeUserRole', 'isAdminUser', 'isSuperUser', 'isSecretaryUser', 'isSupervisorUser', 'isContadorUser',
        'isGuestUser', 'canUseSolicitudData', 'canSeeEstadoFactura', 'getDateRangeExportColumns', 'buildDateRangeExportRows',
        'handleDateRangePrint'];
    const code = names.map((name) => {
        const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
        assert.ok(match, `Función real ${name}`);
        return match[0];
    }).join('\n');
    const printed = [];
    const messages = [];
    const context = {
        currentUser, dateRangeMatches, dateRangeSearchFilters, escapeHtml, ui: { dateRangeMessage: {} },
        window: { SiaSinMovimientoImpresion: impresion },
        openSolicitudPrintFrame: (html) => printed.push(html),
        setFormMessage: (_, text, kind) => messages.push([text, kind]),
        normalizeText: (value) => String(value ?? '').trim(),
        formatDateTime: (value) => String(value ?? ''),
        formatNumIngresoForDateRangeExport: (value) => String(value ?? ''),
        formatEstadoForExport: (value) => String(value ?? '').toUpperCase(),
        getDocumentOptionLabelByValue: () => ''
    };
    vm.runInNewContext(code, context);
    return { context, printed, messages };
}

function registro(numIngreso, extra = {}) {
    return { numIngreso, createdAt: '2026-10-01 10:00', numLotes: 2, nombre: `Nombre ${numIngreso}`, rut: '1-9', rol: '10-2',
        telefono: '911', correo: 'a@b.cl', region: 'MAULE', comuna: 'TALCA', sucursal: 'TALCA', estado: 'facturada',
        estadoCarpeta: 'Observada', ...extra };
}

test('BUSCAR POR FECHA impreso: todas las carpetas (no solo la página), ordenadas por NRO INGRESO, con filtros y total', () => {
    // 32 resultados: más que cualquier página de la ventana.
    const registros = Array.from({ length: 30 }, (_, index) => registro(`${30 - index}-2026`));
    registros.push(registro('100-2025'), registro('raro <x>'));
    const { context, printed } = loadDateRangePrint({ role: 'SECRETARIA' }, registros,
        { desde: '2026-10-01', hasta: '2026-10-31', sucursal: '', region: 'MAULE', comuna: '' });
    context.handleDateRangePrint();
    assert.equal(printed.length, 1);
    const html = printed[0];
    const nums = [...html.matchAll(/<tr><td>\d+<\/td><td>([^<]*)<\/td>/g)].map((m) => m[1]);
    assert.equal(nums.length, 32);
    assert.deepEqual(nums.slice(0, 4), ['100-2025', '1-2026', '2-2026', '3-2026']);
    assert.deepEqual(nums.slice(-2), ['30-2026', 'raro &lt;x&gt;']);
    assert.doesNotMatch(html, /raro <x>/);
    assert.match(html, /<tr><td>1<\/td><td>100-2025<\/td>/, 'el # sigue el orden impreso');
    assert.match(html, /<h1>BÚSQUEDA POR FECHA<\/h1>/);
    assert.match(html, /Fecha de impresión: /);
    assert.match(html, /Desde: 01-10-2026 \| Hasta: 31-10-2026 \| Sucursal: TODAS \| Region: MAULE \| Comuna: TODAS/);
    assert.match(html, /Total: 32 carpetas/);
    assert.match(html, /@page \{ size: letter landscape/);
    assert.match(html, /thead \{ display: table-header-group; \}/);
    assert.equal((html.match(/<table>/g) || []).length, 1, 'una sola tabla');
    assert.equal(registros[0].numIngreso, '30-2026', 'no reordena los resultados de la ventana');
});

test('BUSCAR POR FECHA impreso: columnas del Excel por rol; OPERADOR sin ESTADO FACTURA', () => {
    for (const [role, conEstado] of [['OPERADOR', false], ['SECRETARIA', true], ['SUPERVISOR', true], ['CONTADOR', true],
        ['ADMIN', true], ['SUPER', true]]) {
        const { context, printed } = loadDateRangePrint({ role }, [registro('1-2026')]);
        context.handleDateRangePrint();
        const heads = [...printed[0].matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
        assert.deepEqual(heads, Array.from(context.getDateRangeExportColumns(), ([header]) => header), role);
        assert.equal(heads.includes('ESTADO FACTURA'), conEstado, role);
        assert.equal(heads.length, conEstado ? 14 : 13, role);
        const celdas = (printed[0].match(/<tbody><tr>([\s\S]*?)<\/tr>/)[1].match(/<td[ >]/g) || []).length;
        assert.equal(celdas, heads.length, `${role}: una celda por columna`);
        assert.equal(printed[0].includes('<td>FACTURADA</td>'), conEstado, role);
    }
});

test('BUSCAR POR FECHA impreso: sin resultados no imprime y avisa; la hoja vacía dice «Sin carpetas»', () => {
    const { context, printed, messages } = loadDateRangePrint({ role: 'SECRETARIA' }, []);
    context.handleDateRangePrint();
    assert.equal(printed.length, 0);
    assert.deepEqual(messages, [['No hay resultados para imprimir.', 'error']]);
    const html = impresion.buildDateRangePrintHtml({ printedAt: 'x', filters: {}, columns: ['A', 'B'], registros: [],
        rowsOf: () => { throw new Error('no debe llamarse'); } }, escapeHtml);
    assert.match(html, /<td colspan="2" class="empty">Sin carpetas<\/td>/);
    assert.match(html, /Total: 0 carpetas/);
});

test('BUSCAR POR FECHA: botón IMPRIMIR junto a EXPORTAR EXCEL, deshabilitado de inicio', () => {
    const html = fs.readFileSync(path.join(__dirname, '../registro/login/registro.html'), 'utf8');
    assert.match(html, /id="dateRangeExportBtn"[^>]*>EXPORTAR EXCEL<\/button>\s*<button type="button" id="dateRangePrintBtn" class="buscar" disabled>IMPRIMIR<\/button>/);
});
