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
        numLotes: 3, estadoCarpeta: 'Certificada', facturacion: 'FACTURADA', facturaNumero: '1234', facturaMonto: 1500000,
        detalle: '39 días', ...extra
    };
}

// Solo «ingresos» trae resumenFacturacion (las 3 etiquetas siempre, en el orden del servidor), con monto por clase.
function billingSummary(registros) {
    return reportes.BILLING_STATES.map((etiqueta) => {
        const deLaClase = registros.filter((item) => item.facturacion === etiqueta);
        return { etiqueta, cantidad: deLaClase.length, monto: deLaClase.reduce((sum, item) => sum + (item.facturaMonto || 0), 0) };
    });
}

function payload(tipo, registros = [row()], extra = {}) {
    return {
        tipo, desde: '2026-01-01', hasta: '2026-11-15', filtros: { region: '', sucursal: '' }, total: registros.length,
        resumen: [{ etiqueta: 'Maule', cantidad: registros.length }], registros,
        ...(tipo === 'ingresos' ? { resumenFacturacion: billingSummary(registros) } : {}), ...extra
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
    assert.deepEqual(reportes.columnsFor('ingresos'), ['NRO INGRESO', 'FECHA INGRESO', ...base.slice(0, 7),
        'FACTURACIÓN', 'NRO FACTURA', 'MONTO A FACTURAR', 'DETALLE']);
    assert.deepEqual(reportes.rowCells(row({ facturacion: 'SIN SOLICITAR' }), 'ingresos').slice(8),
        ['Certificada', 'SIN SOLICITAR', '1234', '$ 1.500.000', '39 días']);
    assert.deepEqual(reportes.rowCells(row({ facturaNumero: '', facturaMonto: null }), 'ingresos').slice(10, 12), ['', '']);
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
    let html = '';
    return {
        id, value: '', disabled: false, textContent: '', children: [], dataset: {},
        // Como en el DOM real, innerHTML = '' borra los hijos agregados con appendChild.
        get innerHTML() { return html; },
        set innerHTML(value) { html = value; this.children = []; },
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

function loadReportesUi(extraContext = {}) {
    const elements = {};
    const getElementById = (id) => (elements[id] = elements[id] || fakeElement(id));
    const pending = [];
    const printed = [];
    const context = {
        window: { SiaReportes: reportes, requestAnimationFrame: () => {} },
        document: { getElementById, addEventListener() {}, createElement: () => fakeElement('') },
        apiRequest: (url) => new Promise((resolve) => pending.push({ url, resolve })),
        canUseReports: () => true, currentUser: { role: 'SUPER' },
        setFormMessage: (el, text) => { el.textContent = text; },
        populateRegiones() {}, escapeHtml, openSolicitudPrintFrame: (html) => printed.push(html), URLSearchParams,
        ...extraContext
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/reportes.js'), 'utf8'), context);
    const take = (pattern) => {
        const index = pending.findIndex((item) => pattern.test(item.url));
        assert.ok(index >= 0, `petición ${pattern}`);
        return pending.splice(index, 1)[0];
    };
    return { ui: context.window.SiaReportesUi, el: getElementById, take, printed };
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

// --- M-028: DETALLE DE INGRESOS impreso por estado de carpeta y con facturación ---

const CATALOGO = ['Observada', 'Certificada', 'En revisión', 'Rechazada'];

// Sin segundo argumento usa CATALOGO; con él (aunque sea undefined) se pasa tal cual.
function ingresosHtml(registros, ...rest) {
    const estados = rest.length ? rest[0] : CATALOGO;
    return reportes.buildPrintHtml({ tipo: 'ingresos', data: payload('ingresos', registros), printedAt: 'x', estados }, escapeHtml);
}

const titles = (html) => [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
const subtotals = (html) => [...html.matchAll(/<p class="subtotal">([^<]*)<\/p>/g)].map((m) => m[1]);

test('catálogo: etiquetas en el orden del selector (por grupo y dentro del grupo)', () => {
    const groups = [{ id: 'g1' }, { id: 'g2' }];
    const options = [{ label: 'B', groupId: 'g2' }, { label: 'A', groupId: 'g1' }, { label: 'C', groupId: 'g2' },
        { label: ' ', groupId: 'g1' }, { label: 'Z', groupId: 'otro' }];
    assert.deepEqual(reportes.catalogLabels(groups, options), ['A', 'B', 'C', 'Z']);
    assert.deepEqual(reportes.catalogLabels(undefined, null), []);
});

test('ingresos impreso: Sin estado, Certificada y luego el catálogo en su orden, con subtotales y TOTAL GENERAL', () => {
    const html = ingresosHtml([
        row({ numIngreso: '1', estadoCarpeta: 'Rechazada' }),
        row({ numIngreso: '2', estadoCarpeta: 'Certificada' }),
        row({ numIngreso: '3', estadoCarpeta: 'Sin estado' }),
        row({ numIngreso: '4', estadoCarpeta: 'OBSERVADA' }), // misma clave que «Observada»: no duplica grupo
        row({ numIngreso: '5', estadoCarpeta: 'Certificada' }),
        row({ numIngreso: '6', estadoCarpeta: 'en revision' }) // sin tilde ni mayúsculas: va a «En revisión»
    ]);
    assert.deepEqual(titles(html), ['Sin estado', 'Certificada', 'Observada', 'En revisión', 'Rechazada']);
    assert.deepEqual(subtotals(html), ['Subtotal Sin estado: 1 carpeta', 'Subtotal Certificada: 2 carpetas',
        'Subtotal Observada: 1 carpeta', 'Subtotal En revisión: 1 carpeta', 'Subtotal Rechazada: 1 carpeta']);
    assert.match(html, /<p class="total-general">TOTAL GENERAL: 6 carpetas<\/p>/);
    assert.ok(html.indexOf('TOTAL GENERAL') > html.lastIndexOf('class="subtotal"'));
    assert.match(html, /<h1>DETALLE DE INGRESOS<\/h1>/);
    assert.match(html, /Total: 6 carpetas/);
    assert.match(html, /Resumen: Maule: 6/);
    const cert = html.slice(html.indexOf('<h2>Certificada</h2>'), html.indexOf('<h2>Observada</h2>'));
    assert.equal((cert.match(/<tr><td>[25]<\/td>/g) || []).length, 2);
    for (const column of reportes.columnsFor('ingresos')) assert.ok(html.includes(`<th>${column}</th>`), column);
    assert.match(html, /@page \{ size: letter landscape/);
});

test('ingresos impreso: estados del catálogo sin carpetas van compactos, sin tabla vacía', () => {
    const html = ingresosHtml([row({ estadoCarpeta: 'Observada' })]);
    assert.deepEqual(titles(html), ['Sin estado', 'Certificada', 'Observada', 'En revisión', 'Rechazada']);
    assert.equal((html.match(/<p class="sin-carpetas">Sin carpetas: 0<\/p>/g) || []).length, 4);
    assert.equal((html.match(/<table>/g) || []).length, 1, 'solo la tabla de Observada');
    assert.deepEqual(subtotals(html), ['Subtotal Observada: 1 carpeta']);
    assert.doesNotMatch(html, /class="empty"/);
    assert.match(html, /<h2>Rechazada<\/h2>\n<p class="sin-carpetas">Sin carpetas: 0<\/p>/);
});

test('ingresos impreso: un estado fuera del catálogo va en su propio grupo al final, escapado', () => {
    const html = ingresosHtml([row({ estadoCarpeta: 'Antiguo <x>' }), row({ estadoCarpeta: 'Certificada' }),
        row({ estadoCarpeta: 'Otro viejo' })]);
    assert.deepEqual(titles(html), ['Sin estado', 'Certificada', 'Observada', 'En revisión', 'Rechazada',
        'Antiguo &lt;x&gt;', 'Otro viejo']);
    assert.match(html, /Subtotal Antiguo &lt;x&gt;: 1 carpeta/);
    assert.doesNotMatch(html, /<x>/);
    assert.match(html, /TOTAL GENERAL: 3 carpetas/);
});

test('ingresos impreso sin catálogo: solo estados presentes, con Sin estado y Certificada primero, sin fallar', () => {
    const registros = [row({ estadoCarpeta: 'Rechazada' }), row({ estadoCarpeta: 'Observada' }),
        row({ estadoCarpeta: 'CERTIFICADA' }), row({ estadoCarpeta: '' })];
    for (const estados of [undefined, null, [], 'no es lista', [null, '  ']]) {
        const html = ingresosHtml(registros, estados);
        assert.deepEqual(titles(html), ['Sin estado', 'Certificada', 'Rechazada', 'Observada'], String(estados));
        assert.doesNotMatch(html, /sin-carpetas">/);
        assert.match(html, /TOTAL GENERAL: 4 carpetas/);
    }
    const soloObservada = ingresosHtml([row({ estadoCarpeta: 'Observada' })], undefined);
    assert.deepEqual(titles(soloObservada), ['Observada'], 'sin catálogo no se inventan grupos vacíos');
});

test('ingresos impreso: bloque Facturación con cantidad y monto bajo el resumen, y columnas en cada grupo', () => {
    const registros = [row({ facturacion: 'FACTURADA', facturaMonto: 1234567.5 }),
        row({ facturacion: 'PENDIENTE DE FACTURAR', estadoCarpeta: 'Observada', facturaNumero: '', facturaMonto: 80000 }),
        row({ facturacion: 'SIN SOLICITAR', estadoCarpeta: 'Observada', facturaNumero: '', facturaMonto: null })];
    const html = ingresosHtml(registros);
    assert.match(html, /<p class="meta facturacion">Facturación: FACTURADA: 1 \(\$ 1\.234\.567,5\) \| PENDIENTE DE FACTURAR: 1 \(\$ 80\.000\) \| SIN SOLICITAR: 1 \(\$ 0\)<\/p>/);
    assert.ok(html.indexOf('Resumen:') < html.indexOf('Facturación:'));
    assert.ok(html.indexOf('Facturación:') < html.indexOf('<h2>'));
    for (const column of ['FACTURACIÓN', 'NRO FACTURA', 'MONTO A FACTURAR']) {
        assert.equal(html.split(`<th>${column}</th>`).length - 1, 2, `${column} en cada tabla de grupo`);
    }
    assert.match(html, /<td>Certificada<\/td><td>FACTURADA<\/td><td>1234<\/td><td>\$ 1\.234\.567,5<\/td>/);
    assert.match(html, /<td>Observada<\/td><td>SIN SOLICITAR<\/td><td><\/td><td><\/td>/);
    assert.match(html, /th, td \{ font-size: 7\.5pt;[^}]*overflow-wrap: break-word; \}/, 'letra menor solo en ingresos');
});

test('ingresos impreso: sin montos en el resumen (rol sin acceso) no se muestran montos', () => {
    const registros = [row({ facturaMonto: null }), row({ facturacion: 'SIN SOLICITAR', facturaMonto: null })];
    const sinMonto = billingSummary(registros).map(({ etiqueta, cantidad }) => ({ etiqueta, cantidad }));
    const data = payload('ingresos', registros, { resumenFacturacion: sinMonto });
    assert.equal(reportes.validateResponse(data, 'ingresos').ok, true);
    const html = reportes.buildPrintHtml({ tipo: 'ingresos', data, printedAt: 'x', estados: CATALOGO }, escapeHtml);
    assert.match(html, /Facturación: FACTURADA: 1 \| PENDIENTE DE FACTURAR: 0 \| SIN SOLICITAR: 1<\/p>/);
    assert.doesNotMatch(html.slice(html.indexOf('Facturación:'), html.indexOf('<h2>')), /\$/);
    assert.equal(reportes.billingItemLabel({ etiqueta: 'FACTURADA', cantidad: 2, monto: 0 }, true), 'FACTURADA: 2 ($ 0)');
    assert.equal(reportes.billingItemLabel({ etiqueta: 'FACTURADA', cantidad: 2 }, false), 'FACTURADA: 2');
});

test('validación ingresos: exige resumenFacturacion con las 3 etiquetas y facturación válida por carpeta', () => {
    assert.equal(reportes.validateResponse(payload('ingresos'), 'ingresos').ok, true);
    assert.equal(reportes.validateResponse(payload('ingresos', []), 'ingresos').ok, true);
    assert.equal(reportes.validateResponse(payload('ingresos', [row({ facturaNumero: '', facturaMonto: null })]), 'ingresos').ok, true);
    const tres = billingSummary([row()]);
    const malas = [
        payload('ingresos', [row()], { resumenFacturacion: undefined }),
        payload('ingresos', [row()], { resumenFacturacion: tres.slice(0, 2) }),
        payload('ingresos', [row()], { resumenFacturacion: [tres[0], tres[0], tres[1]] }),
        payload('ingresos', [row()], { resumenFacturacion: [...tres.slice(0, 2), { etiqueta: 'OTRA', cantidad: 0, monto: 0 }] }),
        payload('ingresos', [row()], { resumenFacturacion: [{ ...tres[0], cantidad: '1' }, tres[1], tres[2]] }),
        payload('ingresos', [row()], { resumenFacturacion: [{ ...tres[0], cantidad: 2 }, tres[1], tres[2]] }),
        payload('ingresos', [row()], { resumenFacturacion: [{ ...tres[0], monto: '1500000' }, tres[1], tres[2]] }),
        payload('ingresos', [row()], { resumenFacturacion: [{ ...tres[0], monto: -1 }, tres[1], tres[2]] }),
        payload('ingresos', [row()], { resumenFacturacion: [tres[0], { etiqueta: tres[1].etiqueta, cantidad: 0 }, tres[2]] }),
        payload('ingresos', [row({ facturacion: 'facturada' })]),
        payload('ingresos', [row({ facturacion: undefined })]),
        payload('ingresos', [row({ facturaNumero: null })]),
        payload('ingresos', [row({ facturaNumero: undefined })]),
        payload('ingresos', [row({ facturaMonto: '1500000' })]),
        payload('ingresos', [row({ facturaMonto: undefined })]),
        payload('ingresos', [row({ facturaMonto: NaN })])
    ];
    for (const mala of malas) {
        const result = reportes.validateResponse(mala, 'ingresos');
        assert.equal(result.ok, false, JSON.stringify(mala));
        assert.match(result.error, /no tiene el formato esperado/);
    }
});

test('validación de los otros reportes: no exige facturación', () => {
    for (const tipo of ['certificadas', 'fuera-plazo', 'hallazgos']) {
        // fuera-plazo trae además el motivo de cada carpeta (M-031).
        const motivo = tipo === 'fuera-plazo' ? { motivo: 'INGRESO' } : {};
        const sinCampos = payload(tipo, [row({ facturacion: undefined, facturaNumero: undefined, facturaMonto: undefined, ...motivo })]);
        assert.equal(reportes.validateResponse(sinCampos, tipo).ok, true, tipo);
        for (const column of ['FACTURACIÓN', 'NRO FACTURA', 'MONTO A FACTURAR']) {
            assert.equal(reportes.columnsFor(tipo).includes(column), false, `${tipo} ${column}`);
        }
    }
});

test('certificadas y hallazgos siguen en una sola tabla, sin grupos ni facturación', () => {
    // fuera-plazo salió de esta lista: desde M-031 se imprime en 2 tablas por motivo (prueba propia más abajo).
    for (const tipo of ['certificadas', 'hallazgos']) {
        const html = reportes.buildPrintHtml({ tipo, data: payload(tipo, [row(), row({ estadoCarpeta: 'Observada' })]),
            printedAt: 'x', estados: CATALOGO }, escapeHtml);
        assert.equal((html.match(/<table>/g) || []).length, 1, tipo);
        assert.doesNotMatch(html, /<h2>|subtotal">|TOTAL GENERAL|Facturación|FACTURACIÓN|FACTURA<|sin-carpetas">|7\.5pt/, tipo);
    }
});

test('la hoja de sin movimiento (M-026) mantiene sus dos secciones con subtotal y total general', () => {
    const html = impresion.buildPrintHtml({ title: 'T', printedAt: 'x', filters: {}, rows: [
        { motivo: 'INGRESO', cells: ['1', '<b>'] }] }, escapeHtml);
    assert.deepEqual(titles(html), ['INGRESO', 'REINGRESO SUBSANADA']);
    assert.deepEqual(subtotals(html), ['Subtotal INGRESO: 1 carpeta', 'Subtotal REINGRESO SUBSANADA: 0 carpetas']);
    assert.match(html, /<td colspan="9" class="empty">Sin carpetas<\/td>/);
    assert.match(html, /<td>&lt;b&gt;<\/td><td><\/td>/);
    assert.match(html, /TOTAL GENERAL: 1 carpeta/);
});

test('ventana: Facturación y sus columnas solo en ingresos; la hoja usa el catálogo del selector', async () => {
    const { ui, el, take, printed } = loadReportesUi({
        configuredDocumentGroups: [{ id: 'g1' }, { id: 'g2' }],
        configuredDocumentOptions: [{ label: 'Rechazada', groupId: 'g2' }, { label: 'Observada', groupId: 'g1' }]
    });
    ui.open('ingresos');
    take(/sucursales-disponibles/).resolve({ sucursales: [] });
    const headTexts = () => el('reporteHead').children.map((th) => th.textContent);
    for (const column of ['FACTURACIÓN', 'NRO FACTURA', 'MONTO A FACTURAR']) assert.ok(headTexts().includes(column), column);
    el('reporteFilterForm').dispatch('submit');
    take(/\/reportes\/ingresos/).resolve(payload('ingresos', [row(), row({ facturacion: 'SIN SOLICITAR', facturaMonto: null })]));
    await flush();
    assert.equal(el('reporteFacturacionBloque').classList.contains('hidden'), false);
    assert.deepEqual(el('reporteFacturacion').children.map((li) => li.textContent),
        ['FACTURADA: 1 ($ 1.500.000)', 'PENDIENTE DE FACTURAR: 0 ($ 0)', 'SIN SOLICITAR: 1 ($ 0)']);
    const cells = el('reporteBody').children[0].children.map((td) => td.textContent);
    assert.equal(cells.length, reportes.columnsFor('ingresos').length);
    assert.deepEqual(cells.slice(9, 12), ['FACTURADA', '1234', '$ 1.500.000']);
    el('reporteImprimirBtn').dispatch('click');
    assert.equal(printed.length, 1);
    assert.deepEqual(titles(printed[0]), ['Sin estado', 'Certificada', 'Observada', 'Rechazada']);

    ui.open('certificadas');
    take(/sucursales-disponibles/).resolve({ sucursales: [] });
    assert.equal(el('reporteFacturacionBloque').classList.contains('hidden'), true);
    assert.equal(headTexts().some((name) => /FACTURA/.test(name)), false);
    el('reporteFilterForm').dispatch('submit');
    take(/\/reportes\/certificadas/).resolve(payload('certificadas', [row({ facturacion: undefined })]));
    await flush();
    assert.equal(el('reporteFacturacionBloque').classList.contains('hidden'), true);
    assert.equal(el('reporteFacturacion').children.length, 0);
});

test('ventana: ingresos sin montos muestra solo cantidades', async () => {
    const { ui, el, take } = loadReportesUi();
    ui.open('ingresos');
    take(/sucursales-disponibles/).resolve({ sucursales: [] });
    el('reporteFilterForm').dispatch('submit');
    const registros = [row({ facturaMonto: null })];
    const sinMonto = billingSummary(registros).map(({ etiqueta, cantidad }) => ({ etiqueta, cantidad }));
    take(/\/reportes\/ingresos/).resolve(payload('ingresos', registros, { resumenFacturacion: sinMonto }));
    await flush();
    assert.deepEqual(el('reporteFacturacion').children.map((li) => li.textContent),
        ['FACTURADA: 1', 'PENDIENTE DE FACTURAR: 0', 'SIN SOLICITAR: 0']);
});

test('ventana: ingresos sin resumenFacturacion se muestra como error de formato, no como vacío', async () => {
    const { ui, el, take } = loadReportesUi();
    ui.open('ingresos');
    take(/sucursales-disponibles/).resolve({ sucursales: [] });
    el('reporteFilterForm').dispatch('submit');
    take(/\/reportes\/ingresos/).resolve(payload('ingresos', [row()], { resumenFacturacion: undefined }));
    await flush();
    assert.match(el('reporteMessage').textContent, /no tiene el formato esperado \(resumen de facturación\)/);
    assert.equal(el('reporteResultado').classList.contains('hidden'), true);
    assert.equal(el('reporteImprimirBtn').disabled, true);
});

// --- M-031: hojas impresas ordenadas por NRO INGRESO y fuera de plazo por motivo ---

const numsIn = (html) => [...html.matchAll(/<tr><td>([^<]*)<\/td>/g)].map((m) => m[1]);

test('certificadas y hallazgos impresos: una tabla ordenada por NRO INGRESO (año y correlativo), raros al final', () => {
    for (const tipo of ['certificadas', 'hallazgos']) {
        const registros = ['10-2026', 'X-1', '2-2026', '89-2025', '1-2026', '100-2026'].map((numIngreso) => row({ numIngreso }));
        const data = payload(tipo, registros);
        const html = reportes.buildPrintHtml({ tipo, data, printedAt: 'x' }, escapeHtml);
        assert.equal((html.match(/<table>/g) || []).length, 1, tipo);
        assert.deepEqual(numsIn(html), ['89-2025', '1-2026', '2-2026', '10-2026', '100-2026', 'X-1'], tipo);
        assert.equal(data.registros[0].numIngreso, '10-2026', `${tipo}: no reordena la ventana`);
        assert.match(html, /Total: 6 carpetas/);
    }
});

test('ingresos impreso: cada grupo de estado va ordenado por NRO INGRESO', () => {
    const html = ingresosHtml([
        row({ numIngreso: '12-2026', estadoCarpeta: 'Observada' }), row({ numIngreso: '3-2026', estadoCarpeta: 'Certificada' }),
        row({ numIngreso: '2-2026', estadoCarpeta: 'Observada' }), row({ numIngreso: '50-2025', estadoCarpeta: 'Certificada' }),
        row({ numIngreso: '1-2026', estadoCarpeta: 'Observada' })]);
    const cert = html.slice(html.indexOf('<h2>Certificada</h2>'), html.indexOf('<h2>Observada</h2>'));
    const obs = html.slice(html.indexOf('<h2>Observada</h2>'), html.indexOf('<h2>En revisión</h2>'));
    assert.deepEqual(numsIn(cert), ['50-2025', '3-2026']);
    assert.deepEqual(numsIn(obs), ['1-2026', '2-2026', '12-2026']);
    assert.match(html, /TOTAL GENERAL: 5 carpetas/);
});

function fueraPlazo(registros) {
    const resumen = reportes.FUERA_PLAZO_MOTIVOS.map((etiqueta) => ({ etiqueta,
        cantidad: registros.filter((item) => item.motivo === etiqueta).length }));
    return payload('fuera-plazo', registros, { resumen });
}

test('fuera de plazo impreso: 2 tablas (INGRESO y REINGRESO SUBSANADA) por motivo, ordenadas, con subtotales y TOTAL GENERAL', () => {
    const data = fueraPlazo([
        row({ numIngreso: '10-2026', motivo: 'INGRESO' }), row({ numIngreso: '7-2026', motivo: 'REINGRESO SUBSANADA' }),
        row({ numIngreso: '2-2026', motivo: 'INGRESO' }), row({ numIngreso: '30-2025', motivo: 'REINGRESO SUBSANADA' }),
        row({ numIngreso: '99-2025', motivo: 'INGRESO' })]);
    assert.equal(reportes.validateResponse(data, 'fuera-plazo').ok, true);
    const html = reportes.buildPrintHtml({ tipo: 'fuera-plazo', data, printedAt: 'x' }, escapeHtml);
    assert.deepEqual(titles(html), ['INGRESO', 'REINGRESO SUBSANADA']);
    assert.equal((html.match(/<table>/g) || []).length, 2);
    const [ingreso, reingreso] = html.split('<h2>REINGRESO SUBSANADA</h2>');
    assert.deepEqual(numsIn(ingreso), ['99-2025', '2-2026', '10-2026']);
    assert.deepEqual(numsIn(reingreso), ['30-2025', '7-2026']);
    assert.deepEqual(subtotals(html), ['Subtotal INGRESO: 3 carpetas', 'Subtotal REINGRESO SUBSANADA: 2 carpetas']);
    assert.match(html, /<p class="total-general">TOTAL GENERAL: 5 carpetas<\/p>/);
    assert.match(html, /Total: 5 carpetas/);
    assert.match(html, /Resumen: INGRESO: 3 \| REINGRESO SUBSANADA: 2/);
    for (const column of reportes.columnsFor('fuera-plazo')) {
        assert.equal(html.split(`<th>${column}</th>`).length - 1, 2, `${column} en cada tabla`);
    }
    assert.doesNotMatch(html, /Facturación|7\.5pt/);
});

test('fuera de plazo impreso: un motivo sin carpetas igual muestra su tabla con «Sin carpetas» y subtotal 0', () => {
    const data = fueraPlazo([row({ numIngreso: '1-2026', motivo: 'REINGRESO SUBSANADA' })]);
    const html = reportes.buildPrintHtml({ tipo: 'fuera-plazo', data, printedAt: 'x' }, escapeHtml);
    assert.deepEqual(subtotals(html), ['Subtotal INGRESO: 0 carpetas', 'Subtotal REINGRESO SUBSANADA: 1 carpeta']);
    assert.ok(html.includes(`<td colspan="${reportes.columnsFor('fuera-plazo').length}" class="empty">Sin carpetas</td>`));
    assert.match(html, /TOTAL GENERAL: 1 carpeta</);
});

test('validación fuera de plazo: cada carpeta debe traer motivo INGRESO o REINGRESO SUBSANADA', () => {
    for (const motivo of [undefined, '', 'ingreso', 'OTRO', null]) {
        const result = reportes.validateResponse(fueraPlazo([row({ motivo })]), 'fuera-plazo');
        assert.equal(result.ok, false, String(motivo));
        assert.match(result.error, /no tiene el formato esperado \(motivo de la carpeta 1\)/);
    }
    // Los otros reportes no piden motivo.
    assert.equal(reportes.validateResponse(payload('hallazgos'), 'hallazgos').ok, true);
});
