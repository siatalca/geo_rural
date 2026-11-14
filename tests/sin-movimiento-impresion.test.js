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
