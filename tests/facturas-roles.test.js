const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Carga server.js sin base de datos para probar sus reglas puras.
function loadServer() {
    const serverFile = path.join(__dirname, '../server/server.js');
    const localRequire = createRequire(serverFile);
    const context = {
        require(name) {
            if (name === 'dotenv') return { config: () => ({ parsed: {} }) };
            if (name === 'mysql2/promise') return { createPool() { throw new Error('sin MySQL'); }, createConnection() { throw new Error('sin MySQL'); } };
            return localRequire(name);
        },
        __dirname: path.join(__dirname, '../server'),
        module: { exports: {} },
        // Nombre de base permitido por el site.js de esta instalación (Predia o Geo Rural).
        process: { argv: [], env: { DB_NAME: require('../assets/site/site.js').database.defaultName } },
        console: { ...console, log() {}, info() {}, warn() {} },
        Buffer, URL, setTimeout, clearTimeout
    };
    vm.runInNewContext(fs.readFileSync(serverFile, 'utf8'), context, { filename: serverFile });
    return context;
}
const s = loadServer();
const pdf = (body = '1 0 obj<<>>endobj') => Buffer.from(`%PDF-1.4\n${body}\n%%EOF\n`);
const hoy = new Date(2026, 9, 21, 15, 0, 0);

test('acepta un PDF real con folio numérico y fecha de hoy o anterior', () => {
    const r = s.validateFacturaDocumentoInput({ buffer: pdf(), folio: ' 1543 ', fechaEmision: '2026-10-21' }, hoy);
    assert.equal(r.error, undefined);
    assert.equal(r.data.folio, '1543');
    assert.equal(r.data.fechaEmision, '2026-10-21');
});

test('rechaza archivos que no son PDF, vacíos o demasiado grandes', () => {
    assert.match(s.validateFacturaDocumentoInput({ buffer: Buffer.from('hola'), folio: '1', fechaEmision: '2026-10-01' }, hoy).error, /PDF valido/);
    assert.match(s.validateFacturaDocumentoInput({ buffer: Buffer.from('%PDF-1.4 sin final'), folio: '1', fechaEmision: '2026-10-01' }, hoy).error, /PDF valido/);
    assert.match(s.validateFacturaDocumentoInput({ buffer: Buffer.alloc(0), folio: '1', fechaEmision: '2026-10-01' }, hoy).error, /Adjunta/);
    const grande = s.validateFacturaDocumentoInput({ buffer: Buffer.alloc(10 * 1024 * 1024 + 1), folio: '1', fechaEmision: '2026-10-01' }, hoy);
    assert.equal(grande.status, 413);
});

test('rechaza folios no numéricos y fechas futuras o inválidas', () => {
    assert.match(s.validateFacturaDocumentoInput({ buffer: pdf(), folio: 'F-12', fechaEmision: '2026-10-01' }, hoy).error, /folio/);
    assert.match(s.validateFacturaDocumentoInput({ buffer: pdf(), folio: '12', fechaEmision: '2026-10-22' }, hoy).error, /futura/);
    assert.match(s.validateFacturaDocumentoInput({ buffer: pdf(), folio: '12', fechaEmision: '2026-02-30' }, hoy).error, /fecha/);
    assert.match(s.validateFacturaDocumentoInput({ buffer: pdf(), folio: '12', fechaEmision: '21-10-2026' }, hoy).error, /fecha/);
});

test('sustituir exige un motivo', () => {
    assert.match(s.validateFacturaDocumentoInput({ buffer: pdf(), folio: '12', fechaEmision: '2026-10-01', reemplazar: true, motivo: 'x' }, hoy).error, /motivo/);
    const ok = s.validateFacturaDocumentoInput({ buffer: pdf(), folio: '12', fechaEmision: '2026-10-01', reemplazar: true, motivo: 'Monto corregido' }, hoy);
    assert.equal(ok.data.motivo, 'Monto corregido');
});

test('los archivos guardados no pueden salir de la carpeta de facturas', () => {
    assert.ok(s.resolveFacturaDocumentoPath('2026/12-1.pdf').endsWith(path.join('storage', 'facturas', '2026', '12-1.pdf')));
    assert.equal(s.resolveFacturaDocumentoPath('../../.env'), '');
    assert.equal(s.resolveFacturaDocumentoPath('/etc/passwd'), '');
});

test('permisos de factura por rol', () => {
    const u = (role) => ({ role, username: 'x' });
    assert.deepEqual(['CONTADOR', 'SECRETARIA', 'SUPER', 'ADMIN', 'SUPERVISOR', 'OPERADOR'].map((r) => s.canUploadFacturaDocumento(u(r))), [true, true, true, false, false, false]);
    assert.deepEqual(['CONTADOR', 'SECRETARIA', 'SUPER', 'ADMIN', 'SUPERVISOR', 'OPERADOR'].map((r) => s.canViewFacturaDocumento(u(r))), [true, true, true, true, false, false]);
});

test('un usuario tiene uno o dos roles y SUPER nunca se combina', () => {
    assert.deepEqual(Array.from(s.resolveUserRoles('SECRETARIA', 'CONTADOR')), ['SECRETARIA', 'CONTADOR']);
    assert.deepEqual(Array.from(s.resolveUserRoles('SECRETARIA', 'SECRETARIA')), ['SECRETARIA']);
    // El SUPER puede ver como cualquier rol (empieza siempre como SUPER).
    assert.deepEqual(Array.from(s.resolveUserRoles('SUPER', null)), ['SUPER', 'ADMIN', 'SECRETARIA', 'OPERADOR', 'SUPERVISOR', 'CONTADOR']);
    assert.equal(s.formatAuthUser({ user_id: 1, username: 'admin_sia', role: 'SUPER', active_role: null }).role, 'SUPER');
    assert.equal(s.formatAuthUser({ user_id: 1, username: 'admin_sia', role: 'SUPER', active_role: 'OPERADOR' }).role, 'OPERADOR');
    assert.deepEqual(Array.from(s.resolveUserRoles('CONTADOR', 'SUPER')), ['CONTADOR']);
    assert.deepEqual(Array.from(s.resolveUserRoles('CONTADOR', 'INVENTADO')), ['CONTADOR']);
    const user = s.formatAuthUser({ user_id: 1, username: 'k', role: 'SECRETARIA', role_secundario: 'CONTADOR', active_role: 'CONTADOR' });
    assert.equal(user.role, 'CONTADOR');
    const ajeno = s.formatAuthUser({ user_id: 1, username: 'k', role: 'SECRETARIA', role_secundario: null, active_role: 'SUPER' });
    assert.equal(ajeno.role, 'SECRETARIA');
});

test('seguimiento sin movimiento: roles y comentario de reingreso subsanado', () => {
    const u = (role) => ({ role, username: 'x' });
    assert.deepEqual(['SECRETARIA', 'ADMIN', 'SUPER', 'OPERADOR', 'SUPERVISOR', 'CONTADOR'].map((r) => s.canUseNoMovementFollowup(u(r))), [true, true, true, true, true, false]);
    assert.equal(s.isReingresoSubsanadaComment('Reingreso de carpeta subsanada'), true);
    assert.equal(s.isReingresoSubsanadaComment('REINGRESO DE CARPETA SUBSANADA por el cliente'), true);
    assert.equal(s.isReingresoSubsanadaComment('Carpeta sale para revisión por parte del cliente'), false);
    assert.equal(s.isReingresoSubsanadaComment('observaciones subsanadas'), false);
});

test('el formulario de usuarios valida el rol adicional', () => {
    const superUser = { role: 'SUPER', username: 'admin_sia' };
    const admin = { role: 'ADMIN', username: 'admin' };
    assert.equal(s.resolveSecondaryRoleInput('', 'SECRETARIA', admin).value, null);
    assert.equal(s.resolveSecondaryRoleInput('contador', 'SECRETARIA', admin).value, 'CONTADOR');
    assert.match(s.resolveSecondaryRoleInput('SECRETARIA', 'SECRETARIA', admin).error, /distinto/);
    assert.match(s.resolveSecondaryRoleInput('ADMIN', 'SECRETARIA', admin).error, /invalido|superusuario/);
    assert.equal(s.resolveSecondaryRoleInput('ADMIN', 'SECRETARIA', superUser).value, 'ADMIN');
    assert.match(s.resolveSecondaryRoleInput('CONTADOR', 'SUPER', superUser).error, /SUPER/);
});
