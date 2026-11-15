const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const { ensureBootstrapAccount } = require('../server/bootstrap');

const serverFile = path.join(__dirname, '../server/server.js');

// Mismo adaptador MySQL -> SQLite que tests/indicadores.test.js.
function adaptSql(sql) {
    return sql
        .replaceAll('DATE_ADD(NOW(), INTERVAL ? HOUR)', "datetime('now', '+' || ? || ' hours')")
        .replaceAll('DATE_SUB(NOW(), INTERVAL ? DAY)', "datetime('now', '-' || ? || ' days')")
        .replace(/TIMESTAMPDIFF\(DAY, ([\w.]+), NOW\(\)\)/g, "CAST(julianday('now') - julianday($1) AS INTEGER)")
        .replaceAll('NOW()', "datetime('now')")
        .replaceAll('LEAST(', 'MIN(')
        .replace(/\s+FOR UPDATE/g, '')
        .replace(/^\s*ALTER TABLE (\w+) ADD INDEX (\w+) (\([^)]*\))/, 'CREATE INDEX $2 ON $1 $3')
        .replace(/ AFTER \w+/, '');
}

async function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-reportes-'));
    const credentialPath = path.join(directory, '.local/admin_sia.json');
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, username TEXT UNIQUE, nombre TEXT, sucursal TEXT,
        role TEXT, role_secundario TEXT, password_salt TEXT, password_hash TEXT, must_change_password INTEGER, activo INTEGER,
        onboarding_pending INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT);
        CREATE TABLE sesiones (id INTEGER PRIMARY KEY, user_id INTEGER, active_role TEXT, token_hash TEXT,
        expires_at TEXT, absolute_expires_at TEXT, last_used_at TEXT, revoked_at TEXT);
        CREATE TABLE sistema_configuracion (id INTEGER PRIMARY KEY, folder_status_groups TEXT, folder_status_options TEXT);
        CREATE TABLE registros (id INTEGER PRIMARY KEY, num_ingreso TEXT UNIQUE, correlativo INTEGER, anio INTEGER,
        nombre TEXT, rut TEXT, telefono TEXT, correo TEXT, region TEXT, comuna TEXT, nombre_predio TEXT, rol TEXT, num_lotes INTEGER,
        estado TEXT, estado_carpeta TEXT, comentario TEXT, factura_nombre_razon TEXT, factura_numero TEXT, factura_rut TEXT,
        factura_giro TEXT, factura_direccion TEXT, factura_comuna TEXT, factura_ciudad TEXT, factura_contacto TEXT,
        factura_observacion TEXT, factura_monto REAL, created_by TEXT, created_by_sucursal TEXT, updated_by TEXT,
        updated_by_sucursal TEXT, documentos TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE registro_historial (id INTEGER PRIMARY KEY, registro_id INTEGER, num_ingreso TEXT, accion TEXT, comentario TEXT,
        usuario_nombre TEXT, sucursal TEXT, editado INTEGER DEFAULT 0, editado_por TEXT, editado_por_sucursal TEXT, editado_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);

    const pool = {
        async execute(sql, values = []) {
            const columns = /^\s*SHOW COLUMNS FROM `(\w+)` LIKE '(\w+)'/.exec(sql);
            if (columns) return [db.prepare(`PRAGMA table_info(${columns[1]})`).all().filter((column) => column.name === columns[2])];
            const indexes = /^\s*SHOW INDEX FROM (\w+) WHERE Key_name = '(\w+)'/.exec(sql);
            if (indexes) return [db.prepare(`PRAGMA index_list(${indexes[1]})`).all().filter((index) => index.name === indexes[2])];
            sql = adaptSql(sql);
            const stmt = db.prepare(sql);
            if (/^\s*(SELECT|PRAGMA)/i.test(sql)) return [stmt.all(...values)];
            const result = stmt.run(...values);
            return [{ insertId: Number(result.lastInsertRowid), affectedRows: result.changes }];
        },
        async getConnection() {
            return { execute: pool.execute, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
        }
    };
    pool.query = pool.execute;
    await ensureBootstrapAccount(pool, credentialPath);

    const localRequire = createRequire(serverFile);
    const context = {
        require(name) {
            if (name === 'dotenv') return { config: () => ({ parsed: {} }) };
            if (name === 'mysql2/promise') return {
                createConnection() { throw new Error('Las pruebas no deben conectarse a MySQL'); },
                createPool() { throw new Error('Las pruebas no deben conectarse a MySQL'); }
            };
            return localRequire(name);
        },
        __dirname: path.join(directory, 'server'),
        module: { exports: {} },
        process: { argv: [], env: { DB_NAME: 'sia_core_test' } },
        console: { ...console, log() {}, info() {}, warn() {} },
        Buffer, URL, setTimeout, clearTimeout, testPool: pool
    };
    vm.runInNewContext(fs.readFileSync(serverFile, 'utf8') + '\npool = testPool;', context, { filename: serverFile });
    await context.ensureHistoryIndicadorColumn();

    const server = context.module.exports.app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const origin = `http://127.0.0.1:${server.address().port}`;

    async function get(route, cookie = '') {
        const response = await fetch(origin + route, { headers: cookie ? { Cookie: cookie } : {} });
        const text = await response.text();
        return { status: response.status, json: text ? JSON.parse(text) : null };
    }

    async function loginAs(role, username = role.toLowerCase(), sucursal = 'Casa Matriz') {
        const password = 'Clave-de-prueba-8392!';
        const salt = crypto.randomBytes(16);
        const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
        db.prepare(`INSERT INTO usuarios (username, nombre, sucursal, role, password_salt, password_hash, must_change_password, activo, onboarding_pending)
            VALUES (?, ?, ?, ?, ?, ?, 0, 1, 0)`).run(username, username, sucursal, role, salt.toString('hex'), hash);
        const response = await fetch(`${origin}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        return response.headers.get('set-cookie')?.split(';')[0] || '';
    }

    function registro(id, num, { region = 'Maule', creada = 'Casa Matriz', modificada = null, estado = null } = {}) {
        db.prepare(`INSERT INTO registros (id, num_ingreso, nombre, rut, region, comuna, num_lotes, estado_carpeta, documentos,
            created_by_sucursal, updated_by_sucursal, created_at) VALUES (?, ?, ?, '1-9', ?, 'Talca', 2, ?, '[]', ?, ?, '2020-01-01 00:00:00')`)
            .run(id, num, `Cliente ${num}`, region, estado, creada, modificada);
    }
    function movimiento(id, accion, comentario, fecha, indicador = null) {
        db.prepare(`INSERT INTO registro_historial (registro_id, num_ingreso, accion, comentario, usuario_nombre, created_at, indicador)
            VALUES (?, (SELECT num_ingreso FROM registros WHERE id = ?), ?, ?, 'ana', ${fecha.startsWith('-') ? "datetime('now', ?)" : '?'}, ?)`)
            .run(id, id, accion, comentario, fecha, indicador);
    }

    return { db, get, loginAs, registro, movimiento };
}

// Carpetas de marzo 2026: el rango de las pruebas es 2026-03-01..2026-03-31.
function seedMarzo(f) {
    f.registro(1, '1-2026', { estado: 'recibido' });
    f.movimiento(1, 'CREACION', 'creacion y recepcion', '2026-03-01 00:00:00');
    f.movimiento(1, 'COMENTARIO', 'Notificacion De Hallazgos', '2026-03-02 09:00:00', 'notificacion_hallazgos');
    f.movimiento(1, 'COMENTARIO', 'Notificacion De Hallazgos', '2026-03-15 09:00:00', 'notificacion_hallazgos');
    f.movimiento(1, 'COMENTARIO', 'Notificacion De Hallazgos', '2026-04-02 09:00:00', 'notificacion_hallazgos');
    f.movimiento(1, 'COMENTARIO', 'Notificacion De Hallazgos a mano', '2026-03-16 09:00:00');

    // Certificada, vuelta atras y certificada otra vez dentro de un cambio con varios campos: vale la ultima.
    // Ingresada en Casa Matriz y modificada despues desde Linares: su sede sigue siendo Casa Matriz.
    f.registro(2, '2-2026', { creada: 'Casa Matriz', modificada: 'Linares', estado: 'certificada' });
    f.movimiento(2, 'CREACION', 'creacion y recepcion', '2026-03-05 10:00:00');
    f.movimiento(2, 'MODIFICACION', 'modificacion de estado de carpeta: recibido -> certificada', '2026-03-08 10:00:00');
    f.movimiento(2, 'MODIFICACION', 'modificacion de estado de carpeta: certificada -> recibido', '2026-03-09 10:00:00');
    f.movimiento(2, 'MODIFICACION', 'modificacion de nro de lotes: 1 -> 2 | modificacion de estado de carpeta: recibido -> certificada | documentos agregados: Plano', '2026-03-20 12:00:00');

    // Creada ya certificada (sin movimiento de cambio), ingresada el ultimo segundo del rango.
    f.registro(3, '3-2026', { region: 'Ñuble', creada: 'Talca', estado: 'certificada' });
    f.movimiento(3, 'CREACION', 'creacion y recepcion', '2026-03-31 23:59:59');

    // Certificada y luego rechazada: no sale en certificadas.
    f.registro(4, '4-2026', { estado: 'rechazada' });
    f.movimiento(4, 'CREACION', 'creacion y recepcion', '2026-03-07 08:00:00');
    f.movimiento(4, 'MODIFICACION', 'modificacion de estado de carpeta: recibido -> certificada', '2026-03-10 08:00:00');
    f.movimiento(4, 'MODIFICACION', 'modificacion de estado de carpeta: certificada -> rechazada', '2026-03-12 08:00:00');
    f.movimiento(4, 'COMENTARIO', 'Notificacion De Hallazgos', '2026-03-12 13:00:00', 'notificacion_hallazgos');

    // Fuera del rango por un segundo, antes y despues.
    f.registro(5, '5-2026', { estado: 'certificada' });
    f.movimiento(5, 'CREACION', 'creacion y recepcion', '2026-04-01 00:00:00');
    f.movimiento(5, 'COMENTARIO', 'Notificacion De Hallazgos', '2026-04-05 09:00:00', 'notificacion_hallazgos');
    f.registro(6, '6-2026', { estado: 'recibido' });
    f.movimiento(6, 'CREACION', 'creacion y recepcion', '2026-02-28 23:59:59');
    f.movimiento(6, 'MODIFICACION', 'modificacion de estado de carpeta: recibido -> certificada', '2026-04-01 00:00:00');

    // Sin estado de carpeta.
    f.registro(7, '7-2026');
    f.movimiento(7, 'CREACION', 'creacion y recepcion', '2026-03-15 11:00:00');
}

const MARZO = '?desde=2026-03-01&hasta=2026-03-31';
const nums = (res) => res.json.registros.map((r) => r.numIngreso);

test('reportes: SUPERVISOR, SECRETARIA y SUPER pueden; OPERADOR, ADMIN, CONTADOR, invitado y sin sesion no', async (t) => {
    const f = await fixture(t);
    seedMarzo(f);
    assert.equal((await f.get(`/api/reportes/ingresos${MARZO}`)).status, 401);
    for (const role of ['OPERADOR', 'ADMIN', 'CONTADOR']) {
        const res = await f.get(`/api/reportes/ingresos${MARZO}`, await f.loginAs(role));
        assert.equal(res.status, 403, role);
        assert.deepEqual(Object.keys(res.json), ['message']);
    }
    assert.equal((await f.get(`/api/reportes/ingresos${MARZO}`, await f.loginAs('SECRETARIA', 'invitado'))).status, 403);
    for (const role of ['SUPERVISOR', 'SECRETARIA', 'SUPER']) {
        const cookie = await f.loginAs(role);
        for (const tipo of ['ingresos', 'certificadas', 'fuera-plazo', 'hallazgos']) {
            const res = await f.get(`/api/reportes/${tipo}${MARZO}`, cookie);
            assert.equal(res.status, 200, `${role} ${tipo}`);
            assert.equal(res.json.tipo, tipo);
            assert.equal(res.json.total, res.json.registros.length);
        }
    }
});

test('reportes: rige el rol activo de la sesion (VER COMO)', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('ADMIN', 'doble');
    f.db.prepare("UPDATE usuarios SET role_secundario = 'SUPERVISOR' WHERE username = 'doble'").run();
    assert.equal((await f.get(`/api/reportes/ingresos${MARZO}`, cookie)).status, 403);
    f.db.prepare("UPDATE sesiones SET active_role = 'SUPERVISOR'").run();
    assert.equal((await f.get(`/api/reportes/ingresos${MARZO}`, cookie)).status, 200);
});

test('reportes: fechas faltantes, invalidas, invertidas o rango excesivo dan 400; tipo desconocido 404', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('SUPERVISOR');
    const malos = ['', '?desde=2026-03-01', '?hasta=2026-03-31', '?desde=2026-02-30&hasta=2026-03-31', '?desde=2026/03/01&hasta=2026-03-31',
        '?desde=hoy&hasta=2026-03-31', '?desde=2026-03-31&hasta=2026-03-01', '?desde=2023-01-01&hasta=2026-01-01'];
    for (const query of malos) {
        const res = await f.get(`/api/reportes/ingresos${query}`, cookie);
        assert.equal(res.status, 400, query);
        assert.ok(res.json.message, query);
    }
    assert.equal((await f.get('/api/reportes/ingresos?desde=2023-01-01&hasta=2025-12-31', cookie)).status, 200);
    assert.equal((await f.get(`/api/reportes/ingresos${MARZO}&region=${'x'.repeat(121)}`, cookie)).status, 400);
    for (const tipo of ['otro', 'INGRESOS', 'sin-movimiento']) {
        assert.equal((await f.get(`/api/reportes/${tipo}${MARZO}`, cookie)).status, 404, tipo);
    }
});

test('reportes ingresos: rango inclusive, resumen por estado actual y orden por region, sucursal y fecha', async (t) => {
    const f = await fixture(t);
    seedMarzo(f);
    const res = await f.get(`/api/reportes/ingresos${MARZO}`, await f.loginAs('SUPERVISOR'));
    assert.equal(res.status, 200);
    assert.equal(res.json.desde, '2026-03-01');
    assert.equal(res.json.hasta, '2026-03-31');
    assert.deepEqual(res.json.filtros, { region: '', sucursal: '' });
    // Maule/Casa Matriz por fecha, Nuble/Talca; 5 y 6 quedan fuera por un segundo.
    assert.deepEqual(nums(res), ['1-2026', '2-2026', '4-2026', '7-2026', '3-2026']);
    assert.equal(res.json.total, 5);
    assert.deepEqual(res.json.resumen, [
        { etiqueta: 'Certificada', cantidad: 2 },
        { etiqueta: 'Rechazada', cantidad: 1 },
        { etiqueta: 'Recibido', cantidad: 1 },
        { etiqueta: 'Sin estado', cantidad: 1 }
    ]);
    const primero = res.json.registros[0];
    assert.deepEqual(primero, {
        numIngreso: '1-2026', fechaIngreso: '2026-03-01 00:00:00', fechaEvento: '2026-03-01 00:00:00', nombre: 'Cliente 1-2026',
        rut: '1-9', region: 'Maule', comuna: 'Talca', sucursal: 'Casa Matriz', numLotes: 2, estadoCarpeta: 'Recibido', detalle: '',
        facturaNumero: '', facturaMonto: null, facturacion: 'SIN SOLICITAR'
    });
    assert.equal(res.json.registros.find((r) => r.numIngreso === '2-2026').sucursal, 'Casa Matriz');

    // Un dia exacto en cada borde.
    const cookie = await f.loginAs('SECRETARIA');
    assert.deepEqual(nums(await f.get('/api/reportes/ingresos?desde=2026-03-01&hasta=2026-03-01', cookie)), ['1-2026']);
    assert.deepEqual(nums(await f.get('/api/reportes/ingresos?desde=2026-03-31&hasta=2026-03-31', cookie)), ['3-2026']);
    assert.deepEqual(nums(await f.get('/api/reportes/ingresos?desde=2026-04-01&hasta=2026-04-01', cookie)), ['5-2026']);
});

test('reportes ingresos: facturacion por carpeta y resumenFacturacion fijo; los otros tipos no la traen', async (t) => {
    const f = await fixture(t);
    seedMarzo(f);
    const factura = (num, estado, numero, monto) =>
        f.db.prepare('UPDATE registros SET estado = ?, factura_numero = ?, factura_monto = ? WHERE num_ingreso = ?').run(estado, numero, monto, num);
    const cookie = await f.loginAs('SUPERVISOR');

    // Sin datos de factura: todas SIN SOLICITAR y las otras etiquetas en 0.
    const vacio = await f.get(`/api/reportes/ingresos${MARZO}`, cookie);
    assert.deepEqual(vacio.json.resumenFacturacion, [
        { etiqueta: 'FACTURADA', cantidad: 0, monto: 0 },
        { etiqueta: 'PENDIENTE DE FACTURAR', cantidad: 0, monto: 0 },
        { etiqueta: 'SIN SOLICITAR', cantidad: 5, monto: 0 }
    ]);

    // 1: facturada (variante 'si') con numero y monto. 2: facturada sin monto ni numero.
    // 4: no facturada con monto. 3: sin estado, solo numero. 7: no facturada con monto 0 y numero en blanco.
    // 6 queda fuera del rango aunque este facturada.
    factura('1-2026', 'si', '555', 1500.25);
    factura('2-2026', 'facturada', null, null);
    factura('4-2026', 'no_facturada', '', 2000.5);
    factura('3-2026', null, ' 77 ', null);
    factura('7-2026', 'no_facturada', '  ', 0);
    factura('6-2026', 'facturada', '9', 9999);

    for (const role of ['SUPERVISOR', 'SECRETARIA', 'SUPER']) {
        const res = await f.get(`/api/reportes/ingresos${MARZO}`, role === 'SUPERVISOR' ? cookie : await f.loginAs(role));
        assert.equal(res.status, 200, role);
        assert.deepEqual(res.json.registros.map((r) => [r.numIngreso, r.facturacion, r.facturaNumero, r.facturaMonto]), [
            ['1-2026', 'FACTURADA', '555', 1500.25],
            ['2-2026', 'FACTURADA', '', null],
            ['4-2026', 'PENDIENTE DE FACTURAR', '', 2000.5],
            ['7-2026', 'SIN SOLICITAR', '', 0],
            ['3-2026', 'PENDIENTE DE FACTURAR', '77', null]
        ], role);
        assert.deepEqual(res.json.resumenFacturacion, [
            { etiqueta: 'FACTURADA', cantidad: 2, monto: 1500.25 },
            { etiqueta: 'PENDIENTE DE FACTURAR', cantidad: 2, monto: 2000.5 },
            { etiqueta: 'SIN SOLICITAR', cantidad: 1, monto: 0 }
        ], role);
        assert.equal(res.json.resumenFacturacion.reduce((t, item) => t + item.cantidad, 0), res.json.total, role);
        // El resumen por estado de carpeta no cambia.
        assert.deepEqual(res.json.resumen, vacio.json.resumen, role);
    }

    // Un filtro sin carpetas deja las tres etiquetas en 0 y suma el total.
    const nada = await f.get(`/api/reportes/ingresos${MARZO}&region=Biobio`, cookie);
    assert.equal(nada.json.total, 0);
    assert.deepEqual(nada.json.resumenFacturacion.map((item) => [item.etiqueta, item.cantidad, item.monto]),
        [['FACTURADA', 0, 0], ['PENDIENTE DE FACTURAR', 0, 0], ['SIN SOLICITAR', 0, 0]]);

    for (const tipo of ['certificadas', 'fuera-plazo', 'hallazgos']) {
        const res = await f.get(`/api/reportes/${tipo}?desde=2025-01-01&hasta=2026-12-31`, cookie);
        assert.equal(res.status, 200, tipo);
        assert.ok(!('resumenFacturacion' in res.json), tipo);
        assert.ok(res.json.registros.length > 0, tipo);
        assert.ok(res.json.registros.every((r) => !('facturacion' in r) && !('facturaNumero' in r) && !('facturaMonto' in r)), tipo);
    }
});

test('reportes certificadas: ultima certificacion, sin movimiento usa ingreso y certificada luego cambiada no sale', async (t) => {
    const f = await fixture(t);
    seedMarzo(f);
    const cookie = await f.loginAs('SUPER');
    const res = await f.get(`/api/reportes/certificadas${MARZO}`, cookie);
    assert.equal(res.status, 200);
    // 4 se rechazo despues; 5 y 6 caen fuera (6 ademas no esta certificada).
    assert.deepEqual(nums(res), ['2-2026', '3-2026']);
    const [dos, tres] = res.json.registros;
    assert.equal(dos.fechaEvento, '2026-03-20 12:00:00');
    assert.equal(dos.fechaIngreso, '2026-03-05 10:00:00');
    assert.equal(dos.detalle, '15 días');
    assert.equal(dos.estadoCarpeta, 'Certificada');
    assert.equal(tres.fechaEvento, '2026-03-31 23:59:59');
    assert.equal(tres.detalle, 'Sin fecha de certificación registrada; se usa la fecha de ingreso');
    assert.deepEqual(res.json.resumen, [{ etiqueta: 'Maule', cantidad: 1 }, { etiqueta: 'Ñuble', cantidad: 1 }]);
    assert.equal(res.json.total, 2);

    // El rango se aplica a la fecha de certificacion, no al ingreso.
    assert.deepEqual(nums(await f.get('/api/reportes/certificadas?desde=2026-03-08&hasta=2026-03-19', cookie)), []);
    assert.deepEqual(nums(await f.get('/api/reportes/certificadas?desde=2026-03-20&hasta=2026-03-20', cookie)), ['2-2026']);
    assert.deepEqual(nums(await f.get('/api/reportes/certificadas?desde=2026-04-01&hasta=2026-04-01', cookie)), ['5-2026']);
});

test('reportes certificadas: un comentario resumido posterior a la certificacion detallada usa el respaldo del ingreso', async (t) => {
    const f = await fixture(t);
    const resumido = 'modificacion resumida (5 cambios): registro: nombre, rut, region, comuna, estado de carpeta';
    // Certificada en enero, otro estado en febrero y recertificada en marzo dentro de un comentario resumido.
    f.registro(30, '30-2026', { estado: 'certificada' });
    f.movimiento(30, 'CREACION', 'creacion y recepcion', '2025-12-10 09:00:00');
    f.movimiento(30, 'MODIFICACION', 'modificacion de estado de carpeta: recibido -> certificada', '2026-01-15 10:00:00');
    f.movimiento(30, 'MODIFICACION', 'modificacion de estado de carpeta: certificada -> recibido', '2026-02-10 10:00:00');
    f.movimiento(30, 'MODIFICACION', resumido, '2026-03-12 10:00:00');
    // Resumido ANTERIOR a la certificacion detallada: vale la fecha detallada.
    f.registro(31, '31-2026', { estado: 'certificada' });
    f.movimiento(31, 'CREACION', 'creacion y recepcion', '2025-12-20 09:00:00');
    f.movimiento(31, 'MODIFICACION', resumido, '2026-01-05 10:00:00');
    f.movimiento(31, 'MODIFICACION', 'modificacion de estado de carpeta: recibido -> certificada', '2026-01-20 10:00:00');

    const cookie = await f.loginAs('SUPER');
    const enero = await f.get('/api/reportes/certificadas?desde=2026-01-01&hasta=2026-01-31', cookie);
    assert.equal(enero.status, 200);
    assert.deepEqual(nums(enero), ['31-2026']);
    assert.equal(enero.json.registros[0].fechaEvento, '2026-01-20 10:00:00');
    assert.equal(enero.json.registros[0].detalle, '31 días');

    const diciembre = await f.get('/api/reportes/certificadas?desde=2025-12-01&hasta=2025-12-31', cookie);
    assert.deepEqual(nums(diciembre), ['30-2026']);
    const [treinta] = diciembre.json.registros;
    assert.equal(treinta.fechaEvento, '2025-12-10 09:00:00');
    assert.equal(treinta.fechaIngreso, '2025-12-10 09:00:00');
    assert.equal(treinta.detalle, 'Sin fecha de certificación registrada; se usa la fecha de ingreso');
    assert.deepEqual(nums(await f.get('/api/reportes/certificadas?desde=2026-03-01&hasta=2026-03-31', cookie)), []);
});

test('reportes hallazgos: una fila por carpeta con las notificaciones del rango', async (t) => {
    const f = await fixture(t);
    seedMarzo(f);
    const cookie = await f.loginAs('SUPERVISOR');
    const res = await f.get(`/api/reportes/hallazgos${MARZO}`, cookie);
    assert.equal(res.status, 200);
    // 1: Casa Matriz 15-03 y 4: Casa Matriz 12-03 se ordenan por fecha del ultimo hallazgo; 5 solo tiene uno en abril.
    assert.deepEqual(nums(res), ['4-2026', '1-2026']);
    assert.deepEqual(res.json.registros.map((r) => [r.fechaEvento, r.detalle]), [
        ['2026-03-12 13:00:00', '1 notificación'],
        ['2026-03-15 09:00:00', '2 notificaciones']
    ]);
    assert.deepEqual(res.json.resumen, [{ etiqueta: 'Maule', cantidad: 2 }]);
    const marzoQuince = await f.get('/api/reportes/hallazgos?desde=2026-03-02&hasta=2026-03-02', cookie);
    assert.deepEqual(marzoQuince.json.registros.map((r) => [r.numIngreso, r.fechaEvento, r.detalle]), [['1-2026', '2026-03-02 09:00:00', '1 notificación']]);
});

test('reportes: filtros de region y sucursal (sede) y alcance global de un usuario con sucursal', async (t) => {
    const f = await fixture(t);
    seedMarzo(f);
    const cookie = await f.loginAs('SUPERVISOR', 'sup-talca', 'Talca');
    // getRegistroAccessScope no limita por sucursal: un usuario de Talca ve todas las sedes.
    assert.deepEqual(nums(await f.get(`/api/reportes/ingresos${MARZO}`, cookie)), ['1-2026', '2-2026', '4-2026', '7-2026', '3-2026']);

    const nuble = await f.get(`/api/reportes/ingresos${MARZO}&region=${encodeURIComponent('Ñuble')}`, cookie);
    assert.deepEqual(nums(nuble), ['3-2026']);
    assert.deepEqual(nuble.json.filtros, { region: 'Ñuble', sucursal: '' });
    // La sede es la de ingreso: 2-2026 modificada desde Linares sigue en Casa Matriz.
    assert.deepEqual(nums(await f.get(`/api/reportes/ingresos${MARZO}&sucursal=Talca`, cookie)), ['3-2026']);
    assert.deepEqual(nums(await f.get(`/api/reportes/certificadas${MARZO}&sucursal=Linares`, cookie)), []);
    assert.deepEqual(nums(await f.get(`/api/reportes/certificadas${MARZO}&sucursal=${encodeURIComponent('Casa Matriz')}`, cookie)), ['2-2026']);
    const ambos = await f.get(`/api/reportes/hallazgos${MARZO}&region=Maule&sucursal=${encodeURIComponent('Casa Matriz')}`, cookie);
    assert.deepEqual(nums(ambos), ['4-2026', '1-2026']);
    assert.deepEqual(nums(await f.get(`/api/reportes/hallazgos${MARZO}&region=${encodeURIComponent('Ñuble')}`, cookie)), []);
});

test('reportes fuera-plazo: misma regla que seguimiento sin movimiento, filtrada por la fecha desde la que corre el plazo', async (t) => {
    const f = await fixture(t);
    f.registro(20, '20-2026', { estado: 'recibido', modificada: 'Linares' });
    f.movimiento(20, 'CREACION', 'creacion y recepcion', '-20 days');
    f.registro(21, '21-2026', { region: 'Ñuble' });
    f.movimiento(21, 'CREACION', 'creacion y recepcion', '-60 days');
    f.movimiento(21, 'COMENTARIO', 'Retira Carpeta Para Subsanar Observaciones', '-45 days', 'retira_subsanar');
    f.movimiento(21, 'COMENTARIO', 'Reingresa Carpeta Con Observaciones Subsanadas', '-30 days', 'reingreso_subsanado');
    f.registro(22, '22-2026');
    f.movimiento(22, 'CREACION', 'creacion y recepcion', '-5 days');
    f.registro(23, '23-2026');
    f.movimiento(23, 'CREACION', 'creacion y recepcion', '-100 days');
    f.registro(24, '24-2026');
    f.movimiento(24, 'CREACION', 'creacion y recepcion', '-40 days');
    f.movimiento(24, 'COMENTARIO', 'Llamar Al Cliente', '-35 days');
    const cookie = await f.loginAs('SECRETARIA');
    const dia = (dias) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
    const desde = dia(50);
    const hasta = dia(0);

    const res = await f.get(`/api/reportes/fuera-plazo?desde=${desde}&hasta=${hasta}`, cookie);
    assert.equal(res.status, 200);
    const seguimiento = (await f.get('/api/registros/seguimiento-sin-movimiento', cookie)).json.registros;
    const esperados = seguimiento.filter((r) => r.desdeAt.slice(0, 10) >= desde && r.desdeAt.slice(0, 10) <= hasta);
    assert.deepEqual(seguimiento.map((r) => r.numIngreso).sort(), ['20-2026', '21-2026', '23-2026']);
    assert.deepEqual(nums(res), ['20-2026', '21-2026']);
    assert.deepEqual(nums(res).slice().sort(), esperados.map((r) => r.numIngreso).sort());
    for (const item of res.json.registros) {
        const base = esperados.find((r) => r.numIngreso === item.numIngreso);
        assert.equal(item.fechaEvento, base.desdeAt);
        assert.equal(item.fechaIngreso, base.createdAt);
        assert.equal(item.detalle, `${base.diasSinMovimiento} días sin revisión`);
    }
    assert.equal(res.json.registros[0].detalle, '20 días sin revisión');
    // El reporte usa la sede de ingreso; la ruta existente sigue mostrando la sucursal de la ultima modificacion.
    assert.equal(res.json.registros[0].sucursal, 'Casa Matriz');
    assert.equal(seguimiento.find((r) => r.numIngreso === '20-2026').sucursal, 'Linares');
    assert.deepEqual(nums(await f.get(`/api/reportes/fuera-plazo?desde=${desde}&hasta=${hasta}&sucursal=Linares`, cookie)), []);
    assert.deepEqual(Object.keys(seguimiento[0]), ['numIngreso', 'nombre', 'rut', 'region', 'comuna', 'sucursal', 'createdAt', 'desdeAt', 'motivo', 'totalMovimientos', 'diasSinMovimiento']);
    assert.equal(res.json.registros[0].estadoCarpeta, 'Recibido');
    assert.deepEqual(res.json.resumen, [{ etiqueta: 'INGRESO', cantidad: 1 }, { etiqueta: 'REINGRESO SUBSANADA', cantidad: 1 }]);

    // El rango corre sobre desdeAt: el reingreso de hace 30 dias queda fuera desde hace 25.
    const corto = await f.get(`/api/reportes/fuera-plazo?desde=${dia(25)}&hasta=${hasta}`, cookie);
    assert.deepEqual(nums(corto), ['20-2026']);
    assert.deepEqual(corto.json.resumen, [{ etiqueta: 'INGRESO', cantidad: 1 }, { etiqueta: 'REINGRESO SUBSANADA', cantidad: 0 }]);
    assert.deepEqual(nums(await f.get(`/api/reportes/fuera-plazo?desde=${desde}&hasta=${hasta}&region=${encodeURIComponent('Ñuble')}`, cookie)), ['21-2026']);
});
