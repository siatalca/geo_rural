const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const reportes = require('../assets/js/reportes-impresion.js');
const impresion = require('../assets/js/sin-movimiento-impresion.js');

// Carga las funciones reales de permiso por rol desde script.js (cliente).
function loadClientRoleFunctions() {
    const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
    const names = ['normalizeUserRole', 'isSuperUser', 'isSecretaryUser', 'isSupervisorUser', 'isGuestUser', 'canUseReports'];
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

function row(extra = {}) {
    return {
        numIngreso: '45-2026', fechaIngreso: '2026-03-02T13:00:00.000Z', fechaEvento: '2026-04-10T13:00:00.000Z',
        nombre: 'Ana <b>Pérez</b>', rut: '1-9', region: 'Maule', comuna: 'Talca', sucursal: 'Casa Matriz',
        numLotes: 3, estadoCarpeta: 'Certificada', detalle: '39 días', ...extra
    };
}

function payload(tipo, registros = [row()], extra = {}) {
    return {
        tipo, desde: '2026-01-01', hasta: '2026-11-15', filtros: { region: '', sucursal: '' }, total: registros.length,
        resumen: [{ etiqueta: 'Maule', cantidad: registros.length }], registros, ...extra
    };
}

test('menú REPORTES: solo SUPERVISOR, SECRETARIA y SUPER (rol activo, también en «VER COMO»)', () => {
    const c = loadClientRoleFunctions();
    const roles = ['SUPERVISOR', 'SECRETARIA', 'SUPER', 'OPERADOR', 'ADMIN', 'CONTADOR'];
    assert.deepEqual(roles.map((role) => c.canUseReports({ role, username: 'x' })), [true, true, true, false, false, false]);
    assert.equal(c.canUseReports({ role: 'SUPERVISOR', isGuest: true }), false);
    assert.equal(c.canUseReports(null), false);
});

test('el menú trae los 4 reportes del contrato y la ventana sus filtros con etiqueta', () => {
    const html = fs.readFileSync(path.join(__dirname, '../registro/login/registro.html'), 'utf8');
    const tipos = [...html.matchAll(/data-reporte="([^"]+)">([^<]+)</g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(tipos, [['ingresos', 'DETALLE DE INGRESOS'], ['certificadas', 'CERTIFICADAS POR EL SAG'],
        ['fuera-plazo', 'PENDIENTES FUERA DE PLAZO'], ['hallazgos', 'CON HALLAZGOS']]);
    assert.deepEqual(reportes.TYPES, tipos.map(([tipo]) => tipo));
    for (const id of ['reporteDesde', 'reporteHasta', 'reporteRegion', 'reporteSucursal']) {
        assert.match(html, new RegExp(`<label for="${id}">`), id);
    }
    assert.match(html, /id="reporteImprimirBtn" class="buscar" disabled/);
});

test('rango por defecto: 1 de enero del año actual hasta hoy (hora local)', () => {
    assert.deepEqual(reportes.defaultRange(new Date(2026, 10, 15, 23, 30)), { desde: '2026-01-01', hasta: '2026-11-15' });
    assert.deepEqual(reportes.defaultRange(new Date(2027, 0, 1, 0, 5)), { desde: '2027-01-01', hasta: '2027-01-01' });
});

test('columnas: FECHA EVENTO con nombre propio y sin repetir FECHA INGRESO en Ingresos', () => {
    const base = ['NOMBRE', 'RUT', 'REGIÓN', 'COMUNA', 'SEDE', 'LOTES', 'ESTADO CARPETA', 'DETALLE'];
    assert.deepEqual(reportes.columnsFor('ingresos'), ['NRO INGRESO', 'FECHA INGRESO', ...base]);
    assert.deepEqual(reportes.columnsFor('certificadas'), ['NRO INGRESO', 'FECHA INGRESO', 'FECHA CERTIFICACIÓN', ...base]);
    assert.deepEqual(reportes.columnsFor('fuera-plazo'), ['NRO INGRESO', 'FECHA INGRESO', 'INICIO DEL PLAZO', ...base]);
    assert.deepEqual(reportes.columnsFor('hallazgos'), ['NRO INGRESO', 'FECHA INGRESO', 'FECHA HALLAZGO', ...base]);
    for (const tipo of reportes.TYPES) {
        assert.equal(reportes.rowCells(row(), tipo).length, reportes.columnsFor(tipo).length, tipo);
    }
});

test('fechas: AAAA-MM-DD se muestra tal cual y un instante ISO en fecha local', () => {
    assert.equal(reportes.formatDate('2026-01-01'), '01-01-2026');
    const local = new Date(2026, 2, 2, 10, 0);
    assert.equal(reportes.formatDate(local.toISOString()), '02-03-2026');
    assert.equal(reportes.formatDate(''), '');
    assert.equal(reportes.formatDate('no es fecha'), '');
});

test('respuesta válida pasa; una fuera de contrato se rechaza con mensaje (no como vacío)', () => {
    assert.equal(reportes.validateResponse(payload('certificadas'), 'certificadas').ok, true);
    assert.equal(reportes.validateResponse(payload('ingresos', [], { resumen: [] }), 'ingresos').ok, true);
    assert.equal(reportes.validateResponse(payload('ingresos', [row({ numLotes: '' })]), 'ingresos').ok, true);
    const malas = [
        null,
        [],
        payload('ingresos'), // tipo distinto al pedido
        payload('certificadas', [row()], { total: 2 }),
        payload('certificadas', [row()], { total: '1' }),
        payload('certificadas', [row()], { registros: undefined }),
        payload('certificadas', [row()], { resumen: [{ etiqueta: 'Maule', cantidad: -1 }] }),
        payload('certificadas', [row()], { filtros: null }),
        payload('certificadas', [row()], { desde: 'ayer' }),
        payload('certificadas', [row({ fechaEvento: 'x' })]),
        payload('certificadas', [row({ nombre: null })]),
        payload('certificadas', [row({ numLotes: 'tres' })])
    ];
    for (const mala of malas) {
        const result = reportes.validateResponse(mala, 'certificadas');
        assert.equal(result.ok, false, JSON.stringify(mala));
        assert.match(result.error, /no tiene el formato esperado/);
    }
});

test('hoja impresa: carta horizontal, encabezado repetido, filtros, total, resumen y texto escapado', () => {
    const data = payload('hallazgos', [row(), row({ numIngreso: '46-2026', detalle: '2 notificaciones' })], {
        filtros: { region: 'Maule', sucursal: 'Talca <i>' },
        resumen: [{ etiqueta: 'Maule <x>', cantidad: 2 }]
    });
    const html = reportes.buildPrintHtml({ tipo: 'hallazgos', data, printedAt: '15-11-2026 10:00' }, escapeHtml);
    assert.match(html, /@page \{ size: letter landscape/);
    assert.match(html, /thead \{ display: table-header-group; \}/);
    assert.match(html, /<h1>CON HALLAZGOS<\/h1>/);
    assert.match(html, /Fecha de impresión: 15-11-2026 10:00/);
    assert.match(html, /Desde: 01-01-2026 \| Hasta: 15-11-2026 \| Región: Maule \| Sede: Talca &lt;i&gt;/);
    assert.match(html, /Total: 2 carpetas/);
    assert.match(html, /Resumen: Maule &lt;x&gt;: 2/);
    assert.match(html, /Ana &lt;b&gt;Pérez&lt;\/b&gt;/);
    assert.doesNotMatch(html, /<b>Pérez/);
    for (const column of reportes.columnsFor('hallazgos')) assert.ok(html.includes(`<th>${column}</th>`), column);
    assert.equal((html.match(/<tbody>[\s\S]*?<\/tbody>/)[0].match(/<tr>/g) || []).length, 2);
});

test('sin filtros la hoja dice Todas; Ingresos no repite la fecha', () => {
    const html = reportes.buildPrintHtml({ tipo: 'ingresos', data: payload('ingresos'), printedAt: 'x' }, escapeHtml);
    assert.match(html, /Región: Todas \| Sede: Todas/);
    assert.equal((html.match(/<th>FECHA INGRESO<\/th>/g) || []).length, 1);
    assert.doesNotMatch(html, /FECHA EVENTO/);
});

// DOM mínimo para cargar reportes.js real en vm (sin navegador).
function fakeElement(id) {
    const classes = new Set(id === 'reporteOverlay' || id === 'reporteResultado' ? ['hidden'] : []);
    const listeners = {};
    return {
        id, value: '', disabled: false, innerHTML: '', textContent: '', children: [], dataset: {},
        classList: {
            add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
            toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
        },
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        dispatch: (type, event = {}) => (listeners[type] || []).forEach((fn) => fn({ preventDefault() {}, ...event })),
        appendChild(child) { this.children.push(child); },
        setAttribute() {}, focus() {}
    };
}

function loadReportesUi() {
    const elements = {};
    const getElementById = (id) => (elements[id] = elements[id] || fakeElement(id));
    const pending = [];
    const context = {
        window: { SiaReportes: reportes, requestAnimationFrame: () => {} },
        document: { getElementById, addEventListener() {}, createElement: () => fakeElement('') },
        apiRequest: (url) => new Promise((resolve) => pending.push({ url, resolve })),
        canUseReports: () => true, currentUser: { role: 'SUPER' },
        setFormMessage: (el, text) => { el.textContent = text; },
        populateRegiones() {}, escapeHtml, openSolicitudPrintFrame() {}, URLSearchParams
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/reportes.js'), 'utf8'), context);
    const take = (pattern) => {
        const index = pending.findIndex((item) => pattern.test(item.url));
        assert.ok(index >= 0, `petición ${pattern}`);
        return pending.splice(index, 1)[0];
    };
    return { ui: context.window.SiaReportesUi, el: getElementById, take };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('cambiar un filtro durante BUSCAR descarta la respuesta de los filtros anteriores', async () => {
    const { ui, el, take } = loadReportesUi();
    ui.open('ingresos');
    take(/sucursales-disponibles/).resolve({ sucursales: [] });
    el('reporteFilterForm').dispatch('submit');
    assert.equal(el('reporteBuscarBtn').disabled, true);
    const busqueda = take(/\/reportes\/ingresos/);
    el('reporteRegion').value = 'Maule';
    el('reporteFilterForm').dispatch('change');
    assert.equal(el('reporteBuscarBtn').disabled, false);
    assert.match(el('reporteMessage').textContent, /presiona BUSCAR/);
    busqueda.resolve(payload('ingresos'));
    await flush();
    assert.equal(el('reporteResultado').classList.contains('hidden'), true);
    assert.equal(el('reporteImprimirBtn').disabled, true);
    assert.equal(el('reporteBuscarBtn').disabled, false);
    assert.match(el('reporteMessage').textContent, /presiona BUSCAR/);
});

test('la sede elegida antes de que llegue la lista se conserva si sigue existiendo', async () => {
    const { ui, el, take } = loadReportesUi();
    ui.open('ingresos');
    el('reporteSucursal').value = 'Talca';
    take(/sucursales-disponibles/).resolve({ sucursales: ['Linares', 'Talca'] });
    await flush();
    assert.equal(el('reporteSucursal').value, 'Talca');
    ui.open('ingresos');
    assert.equal(el('reporteSucursal').value, '', 'al abrir de nuevo parte en TODAS');
    el('reporteSucursal').value = 'Curicó';
    take(/sucursales-disponibles/).resolve({ sucursales: ['Linares'] });
    await flush();
    assert.equal(el('reporteSucursal').value, '', 'sede que ya no existe vuelve a TODAS');
});

test('la envoltura compartida no cambia la hoja de sin movimiento (M-026)', () => {
    const html = impresion.buildPrintHtml({ title: 'T', printedAt: 'x', filters: {}, rows: [] }, escapeHtml);
    assert.match(html, /print-color-adjust: exact; \}\n<\/style>/);
    assert.doesNotMatch(html, /\.resumen/);
});
