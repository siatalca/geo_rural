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
const NUM = '10-2026';
const RUT = '12.345.678-5';

// Solo se adapta la sintaxis MySQL a SQLite; las consultas y los datos se ejecutan realmente.
function adaptSql(sql) {
    return sql
        .replaceAll('DATE_ADD(NOW(), INTERVAL ? HOUR)', "datetime('now', '+' || ? || ' hours')")
        .replaceAll('DATE_SUB(NOW(), INTERVAL ? DAY)', "datetime('now', '-' || ? || ' days')")
        .replace(/TIMESTAMPDIFF\(DAY, ([\w.]+), NOW\(\)\)/g, "CAST(julianday('now') - julianday($1) AS INTEGER)")
        .replaceAll('NOW()', "datetime('now')")
        .replaceAll('LEAST(', 'MIN(')
        .replace(/\s+FOR UPDATE/g, '')
        .replace(/ON DUPLICATE KEY UPDATE ([\s\S]*)$/, (_, sets) => `ON CONFLICT(registro_id) DO UPDATE SET ${sets.replace(/VALUES\((\w+)\)/g, 'excluded.$1')}`)
        .replace(/ AFTER \w+/, '');
}

async function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-descuento-'));
    const credentialPath = path.join(directory, '.local/admin_sia.json');
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, username TEXT UNIQUE, nombre TEXT, sucursal TEXT,
        role TEXT, role_secundario TEXT, password_salt TEXT, password_hash TEXT, must_change_password INTEGER, activo INTEGER,
        onboarding_pending INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT);
        CREATE TABLE sesiones (id INTEGER PRIMARY KEY, user_id INTEGER, active_role TEXT, token_hash TEXT,
        expires_at TEXT, absolute_expires_at TEXT, last_used_at TEXT, revoked_at TEXT);
        CREATE TABLE sistema_configuracion (id INTEGER PRIMARY KEY, folder_status_groups TEXT, folder_status_options TEXT);
        CREATE TABLE utm_mensual (anio INTEGER, mes INTEGER, valor REAL);
        CREATE TABLE registros (id INTEGER PRIMARY KEY, num_ingreso TEXT UNIQUE, correlativo INTEGER, anio INTEGER,
        nombre TEXT, rut TEXT, telefono TEXT, correo TEXT, region TEXT, comuna TEXT, nombre_predio TEXT, rol TEXT, num_lotes INTEGER,
        estado TEXT, estado_carpeta TEXT, comentario TEXT, factura_nombre_razon TEXT, factura_numero TEXT, factura_rut TEXT,
        factura_giro TEXT, factura_direccion TEXT, factura_comuna TEXT, factura_ciudad TEXT, factura_contacto TEXT,
        factura_observacion TEXT, factura_monto REAL, created_by TEXT, created_by_sucursal TEXT, updated_by TEXT,
        updated_by_sucursal TEXT, documentos TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE registro_solicitud (registro_id INTEGER PRIMARY KEY, solicitante_domicilio TEXT, solicita_tercero TEXT,
        tercero_nombre TEXT, tercero_rut TEXT, predio_provincia TEXT, inscripcion_fojas TEXT, inscripcion_numero TEXT,
        inscripcion_anio TEXT, inscripcion_cbr TEXT, rol_comuna TEXT, superficie TEXT, profesional_nombre TEXT,
        profesional_titulo TEXT, descuento_porcentaje TEXT, updated_by TEXT);
        CREATE TABLE registro_historial (id INTEGER PRIMARY KEY, registro_id INTEGER, num_ingreso TEXT, accion TEXT, comentario TEXT,
        usuario_nombre TEXT, sucursal TEXT, editado INTEGER DEFAULT 0, editado_por TEXT, editado_por_sucursal TEXT, editado_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE registro_documentos_alertas (id INTEGER PRIMARY KEY, registro_id INTEGER, num_ingreso TEXT, sucursal TEXT,
        documentos_agregados TEXT, revisado INTEGER DEFAULT 0, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);

    const pool = {
        async execute(sql, values = []) {
            const match = /^\s*SHOW COLUMNS FROM `(\w+)` LIKE '(\w+)'/.exec(sql);
            if (match) return [db.prepare(`PRAGMA table_info(${match[1]})`).all().filter((column) => column.name === match[2])];
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
    const server = context.module.exports.app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const origin = `http://127.0.0.1:${server.address().port}`;

    async function call(method, route, cookie = '', body) {
        const response = await fetch(origin + route, {
            method,
            headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        const text = await response.text();
        return { status: response.status, text, json: text ? JSON.parse(text) : null };
    }

    async function loginAs(role, username = role.toLowerCase()) {
        const password = 'Clave-de-prueba-8392!';
        const salt = crypto.randomBytes(16);
        const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
        db.prepare(`INSERT INTO usuarios (username, nombre, sucursal, role, password_salt, password_hash, must_change_password, activo, onboarding_pending)
            VALUES (?, ?, 'Casa Matriz', ?, ?, ?, 0, 1, 0)`).run(username, username, role, salt.toString('hex'), hash);
        const response = await fetch(`${origin}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        return response.headers.get('set-cookie')?.split(';')[0] || '';
    }

    // Carpeta facturada, con descuento y con historial que menciona datos de factura.
    db.exec(`INSERT INTO utm_mensual VALUES (2026, 1, 60000), (2026, 3, 70000);
        INSERT INTO registros (id, num_ingreso, correlativo, anio, nombre, rut, region, comuna, rol, num_lotes, estado, estado_carpeta,
            comentario, factura_nombre_razon, factura_numero, factura_monto, documentos, created_by_sucursal, created_at)
        VALUES (1, '${NUM}', 10, 2026, 'Ana', '${RUT}', 'Maule', 'Talca', '100-1', 3, 'facturada', 'en_tramite', 'x', 'Ana SpA', '555', 100000, '[]', 'Casa Matriz', '2026-01-20 10:00:00');
        INSERT INTO registro_solicitud (registro_id, descuento_porcentaje) VALUES (1, '10');
        INSERT INTO registro_historial (registro_id, num_ingreso, accion, comentario, usuario_nombre) VALUES
            (1, '${NUM}', 'CREACION', 'creacion y recepcion', 'ana'),
            (1, '${NUM}', 'COMENTARIO', 'llamar al cliente', 'ana'),
            (1, '${NUM}', 'MODIFICACION', 'modificacion de estado de factura: no facturado -> facturado | modificacion de region: Biobio -> Maule', 'ana'),
            (1, '${NUM}', 'MODIFICACION', 'modificacion de monto a facturar: $1 -> $100000', 'ana'),
            (1, '${NUM}', 'MODIFICACION', 'modificacion de datos de solicitud (descuento (%))', 'ana'),
            (1, '${NUM}', 'FACTURA', 'factura folio 555 adjuntada (emitida 2026-01-25)', 'ana');
        INSERT INTO registro_documentos_alertas (registro_id, num_ingreso, sucursal, documentos_agregados, created_by)
        VALUES (1, '${NUM}', 'Casa Matriz', '["plano"]', 'ana');`);

    return { db, call, loginAs, context, registro: () => db.prepare('SELECT * FROM registros WHERE id = 1').get(), solicitud: () => db.prepare('SELECT * FROM registro_solicitud WHERE registro_id = 1').get() };
}

const putBody = (extra = {}) => ({ nombre: 'Ana', rut: RUT, region: 'Maule', comuna: 'Talca', rol: '100-1', numLotes: 3, documentos: [], ...extra });
const facturaCompleta = (montoFacturar) => ({ nombreRazonSocial: 'Ana SpA', montoFacturar });
const calculo = (query) => `/api/cotizaciones/calculo?${query}`;

test('calculo: secretaria, admin y super reciben el monto; los demas roles no', async (t) => {
    const f = await fixture(t);
    assert.equal((await f.call('GET', calculo('numLotes=3'))).status, 401);

    for (const role of ['SECRETARIA', 'ADMIN', 'SUPER']) {
        const res = await f.call('GET', calculo(`numLotes=3&numIngreso=${NUM}`), await f.loginAs(role));
        assert.equal(res.status, 200, role);
        assert.equal(res.json.monto, 342506, role);
    }

    const invitado = await f.loginAs('SECRETARIA', 'invitado');
    for (const cookie of [await f.loginAs('OPERADOR'), await f.loginAs('SUPERVISOR'), await f.loginAs('CONTADOR'), invitado]) {
        const res = await f.call('GET', calculo(`numLotes=3&numIngreso=${NUM}`), cookie);
        assert.equal(res.status, 403);
        assert.deepEqual(Object.keys(res.json), ['message']);
    }
});

test('calculo: total con IVA menos el descuento, con la UTM del mes de ingreso', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('ADMIN');

    // Enero: UTM 60.000 -> neto 319.800, IVA 60.762, total 380.562. El descuento guardado es 10 %.
    const guardado = await f.call('GET', calculo(`numLotes=3&numIngreso=${NUM}`), cookie);
    assert.equal(guardado.json.cotizacion.utmValor, 60000);
    assert.equal(guardado.json.cotizacion.total, 380562);
    assert.equal(guardado.json.descuentoPorcentaje, 10);
    assert.equal(guardado.json.descuentoMonto, 38056);
    assert.equal(guardado.json.monto, 342506);

    // El descuento recibido manda sobre el guardado, incluso vacio.
    const conComa = await f.call('GET', calculo(`numLotes=3&numIngreso=${NUM}&descuentoPorcentaje=12,5`), cookie);
    assert.equal(conComa.json.descuentoPorcentaje, 12.5);
    assert.equal(conComa.json.monto, 332992);
    const vacio = await f.call('GET', calculo(`numLotes=3&numIngreso=${NUM}&descuentoPorcentaje=`), cookie);
    assert.equal(vacio.json.descuentoPorcentaje, 0);
    assert.equal(vacio.json.monto, 380562);
    const total = await f.call('GET', calculo(`numLotes=3&numIngreso=${NUM}&descuentoPorcentaje=100`), cookie);
    assert.equal(total.json.monto, 0);
    assert.equal(total.json.descuentoMonto, 380562);

    // Sin ingreso: UTM vigente (la ultima registrada) y sin descuento.
    const sinIngreso = await f.call('GET', calculo('numLotes=3'), cookie);
    assert.equal(sinIngreso.json.cotizacion.utmValor, 70000);
    assert.equal(sinIngreso.json.monto, 443989);
});

test('calculo: entradas invalidas se rechazan y sin datos no inventa un monto', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('SECRETARIA');

    for (const lotes of ['abc', '-1', '0', '1.5', '1e2', '0x10', '3&numLotes=4']) {
        assert.equal((await f.call('GET', calculo(`numLotes=${lotes}`), cookie)).status, 400, `lotes ${lotes}`);
    }
    for (const descuento of ['101', '100.01', 'abc', '-5', '1e1', '0x10', 'Infinity', '5&descuentoPorcentaje=6']) {
        const res = await f.call('GET', calculo(`numLotes=3&descuentoPorcentaje=${descuento}`), cookie);
        assert.equal(res.status, 400, `descuento ${descuento}`);
        assert.match(res.json.message, /DESCUENTO/);
    }
    assert.equal((await f.call('GET', calculo('numLotes=3&numIngreso=nada'), cookie)).status, 400);
    assert.equal((await f.call('GET', calculo('numLotes=3&numIngreso=999-2026'), cookie)).status, 404);

    const sinNada = { cotizacion: null, descuentoPorcentaje: 0, descuentoMonto: null, monto: null };
    assert.deepEqual((await f.call('GET', calculo('numLotes='), cookie)).json, sinNada);
    assert.deepEqual((await f.call('GET', '/api/cotizaciones/calculo', cookie)).json, sinNada);
    assert.deepEqual((await f.call('GET', calculo('numLotes=99999'), cookie)).json, sinNada);
    f.db.exec('DELETE FROM utm_mensual');
    assert.deepEqual((await f.call('GET', calculo('numLotes=3'), cookie)).json, sinNada);
});

test('el operador no recibe estado de factura ni descuento en consultas, exportaciones ni alertas', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('OPERADOR');
    const rutas = [
        `/api/registros/buscar?numIngreso=${NUM}`,
        `/api/registros/${NUM}/historial`,
        // Con estas dos el navegador arma las exportaciones del operador.
        '/api/registros/buscar-rango-fechas?fechaDesde=2026-01-01&fechaHasta=2026-12-31',
        '/api/registros/carpeta-estados?estadoCarpeta=en_tramite',
        '/api/registros/seguimiento-sin-movimiento?dias=1',
        '/api/registros/documentos-alertas'
    ];
    for (const ruta of rutas) {
        const res = await f.call('GET', ruta, cookie);
        assert.equal(res.status, 200, ruta);
        assert.doesNotMatch(res.text, /"estado":|facturad|numeroFactura|folio|descuento/i, ruta);
    }

    const buscar = await f.call('GET', `/api/registros/buscar?numIngreso=${NUM}`, cookie);
    assert.equal(buscar.json.estadoCarpeta, 'en_tramite');
    assert.deepEqual(buscar.json.historial.map((h) => h.comentario).sort(), [
        'creacion y recepcion',
        'llamar al cliente',
        'modificacion de region: Biobio -> Maule'
    ]);
    const rango = await f.call('GET', rutas[2], cookie);
    assert.equal(rango.json.registros.length, 1);
    assert.equal((await f.call('GET', rutas[3], cookie)).json.registros.length, 1);
    assert.equal((await f.call('GET', `/api/registros/${NUM}/solicitud`, cookie)).status, 403);
});

test('el operador no recibe el folio en las solicitudes de factura; secretaria y super si', async (t) => {
    const f = await fixture(t);
    f.db.exec(`CREATE TABLE factura_solicitudes (id INTEGER PRIMARY KEY, num_ingreso TEXT, nombre_razon_social TEXT, rut TEXT, giro TEXT,
            direccion TEXT, comuna TEXT, ciudad TEXT, contacto TEXT, observacion TEXT, monto_facturar REAL, destino_email TEXT, estado TEXT,
            created_by TEXT, created_by_sucursal TEXT, sent_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE factura_documentos (id INTEGER PRIMARY KEY, activo_solicitud_id INTEGER, folio TEXT, fecha_emision TEXT);
        INSERT INTO factura_solicitudes (id, num_ingreso, nombre_razon_social, rut, monto_facturar, estado, created_by_sucursal)
        VALUES (1, '${NUM}', 'Ana SpA', '${RUT}', 100000, 'ENVIADA', 'Casa Matriz');
        INSERT INTO factura_documentos (activo_solicitud_id, folio, fecha_emision) VALUES (1, '1543', '2026-01-25');`);

    const operador = await f.call('GET', '/api/facturas/solicitudes', await f.loginAs('OPERADOR'));
    assert.equal(operador.status, 200);
    assert.equal(operador.json.solicitudes.length, 1);
    assert.equal('documento' in operador.json.solicitudes[0], false);
    assert.doesNotMatch(operador.text, /1543|folio/);
    assert.equal(operador.json.solicitudes[0].montoFacturar, '100000.00');
    assert.equal(operador.json.solicitudes[0].estado, 'ENVIADA');

    for (const role of ['SECRETARIA', 'SUPER']) {
        const res = await f.call('GET', '/api/facturas/solicitudes', await f.loginAs(role));
        assert.deepEqual({ ...res.json.solicitudes[0].documento }, { folio: '1543', fechaEmision: '2026-01-25' }, role);
    }
});

test('supervisor y contador ven estado, numero y filas FACTURA, pero no el descuento', async (t) => {
    const f = await fixture(t);
    f.db.exec(`INSERT INTO registro_historial (registro_id, num_ingreso, accion, comentario, usuario_nombre) VALUES
        (1, '${NUM}', 'MODIFICACION', 'modificacion resumida (6 cambios): factura: numero, monto a facturar | datos de solicitud (provincia, descuento (%))', 'ana')`);
    for (const role of ['SUPERVISOR', 'CONTADOR']) {
        const cookie = await f.loginAs(role);
        const buscar = await f.call('GET', `/api/registros/buscar?numIngreso=${NUM}`, cookie);
        assert.equal(buscar.status, 200, role);
        assert.equal(buscar.json.estado, 'facturada', role);
        assert.equal(buscar.json.factura.numeroFactura, '555', role);
        assert.equal(buscar.json.factura.montoFacturar, '100000.00', role);
        assert.doesNotMatch(buscar.text, /descuento/i, role);

        const comentarios = (await f.call('GET', `/api/registros/${NUM}/historial`, cookie)).json.historial.map((h) => h.comentario).sort();
        assert.deepEqual(comentarios, [
            'creacion y recepcion',
            'factura folio 555 adjuntada (emitida 2026-01-25)',
            'llamar al cliente',
            'modificacion de estado de factura: no facturado -> facturado | modificacion de region: Biobio -> Maule',
            'modificacion de monto a facturar: $1 -> $100000',
            'modificacion resumida (6 cambios): factura: numero, monto a facturar | datos de solicitud (provincia)'
        ], role);

        const rango = await f.call('GET', '/api/registros/buscar-rango-fechas?fechaDesde=2026-01-01&fechaHasta=2026-12-31', cookie);
        assert.equal(rango.json.registros[0].estado, 'facturada', role);

        // Solo ganan lectura: descuento, calculo y escritura siguen cerrados.
        assert.equal((await f.call('GET', `/api/registros/${NUM}/solicitud`, cookie)).status, 403, role);
        assert.equal((await f.call('GET', calculo('numLotes=3'), cookie)).status, 403, role);
    }
});

test('un invitado con rol de supervisor y el progreso publico no reciben el estado de factura', async (t) => {
    const f = await fixture(t);
    const invitado = await f.loginAs('SUPERVISOR', 'invitado');
    const buscarInvitado = await f.call('GET', `/api/registros/buscar?numIngreso=${NUM}`, invitado);
    assert.equal(buscarInvitado.status, 200);
    assert.doesNotMatch(buscarInvitado.text, /"estado":|facturad|numeroFactura|folio|descuento/i);
    const rangoInvitado = await f.call('GET', '/api/registros/buscar-rango-fechas?fechaDesde=2026-01-01&fechaHasta=2026-12-31', invitado);
    assert.doesNotMatch(rangoInvitado.text, /"estado":/);

    const publico = await f.call('GET', '/api/public/registros/progreso?rol=100-1');
    assert.equal(publico.status, 200);
    assert.match(publico.text, /llamar al cliente/);
    assert.doesNotMatch(publico.text, /facturad|folio|descuento|100000/i);
});

test('secretaria, admin y super si reciben el estado, el numero y el historial completo', async (t) => {
    const f = await fixture(t);
    for (const role of ['SECRETARIA', 'ADMIN', 'SUPER']) {
        const cookie = await f.loginAs(role);
        const buscar = await f.call('GET', `/api/registros/buscar?numIngreso=${NUM}`, cookie);
        assert.equal(buscar.json.estado, 'facturada', role);
        assert.equal(buscar.json.factura.numeroFactura, '555', role);
        assert.equal(buscar.json.factura.montoFacturar, '100000.00', role);
        assert.equal(buscar.json.historial.length, 6, role);
        const rango = await f.call('GET', '/api/registros/buscar-rango-fechas?fechaDesde=2026-01-01&fechaHasta=2026-12-31', cookie);
        assert.equal(rango.json.registros[0].estado, 'facturada', role);
        const solicitud = await f.call('GET', `/api/registros/${NUM}/solicitud`, cookie);
        assert.equal(solicitud.json.solicitud.descuentoPorcentaje, '10', role);
    }
});

test('si el operador modifica la carpeta se conservan estado, numero, monto y descuento', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('OPERADOR');

    const conDatos = await f.call('PUT', `/api/registros/${NUM}`, cookie, {
        estado: 'no_facturada',
        estadoCarpeta: 'en_revision',
        factura: { numeroFactura: '999', montoFacturar: '1' },
        solicitud: { descuentoPorcentaje: '99' }
    });
    assert.equal(conDatos.status, 200);
    let registro = f.registro();
    assert.equal(registro.estado_carpeta, 'en_revision');
    assert.equal(registro.estado, 'facturada');
    assert.equal(registro.factura_numero, '555');
    assert.equal(registro.factura_monto, 100000);
    assert.equal(f.solicitud().descuento_porcentaje, '10');

    const sinDatos = await f.call('PUT', `/api/registros/${NUM}`, cookie, { estadoCarpeta: 'en_tramite' });
    assert.equal(sinDatos.status, 200);
    registro = f.registro();
    assert.equal(registro.estado_carpeta, 'en_tramite');
    assert.equal(registro.estado, 'facturada');
    assert.equal(registro.factura_monto, 100000);
    assert.equal(f.solicitud().descuento_porcentaje, '10');
});

test('otros roles sin permiso no cambian el estado de factura ni el descuento', async (t) => {
    const f = await fixture(t);
    const contador = await f.loginAs('CONTADOR');

    for (const estado of ['no_facturada', undefined]) {
        const res = await f.call('PUT', `/api/registros/${NUM}`, contador, putBody({ estado, comuna: `Talca ${estado}`, solicitud: { descuentoPorcentaje: '50' } }));
        assert.equal(res.status, 200);
        assert.equal(f.registro().estado, 'facturada');
        assert.equal(f.solicitud().descuento_porcentaje, '10');
    }

    const creado = await f.call('POST', '/api/registros', contador, putBody({ estado: 'facturada', solicitud: { descuentoPorcentaje: '50' } }));
    assert.equal(creado.status, 201);
    const nuevo = f.db.prepare('SELECT id, estado FROM registros WHERE num_ingreso = ?').get(creado.json.numIngreso);
    assert.equal(nuevo.estado, null);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM registro_solicitud WHERE registro_id = ?').get(nuevo.id).n, 0);

    const supervisor = await f.loginAs('SUPERVISOR');
    assert.equal((await f.call('PUT', `/api/registros/${NUM}`, supervisor, putBody({ estado: 'no_facturada' }))).status, 403);
    assert.equal((await f.call('POST', '/api/registros', await f.loginAs('OPERADOR'), putBody({ estado: 'facturada' }))).status, 403);
});

test('secretaria, admin y super guardan y validan el descuento y el estado', async (t) => {
    const f = await fixture(t);
    let descuento = 10;
    for (const role of ['SECRETARIA', 'ADMIN', 'SUPER']) {
        const cookie = await f.loginAs(role);
        descuento += 1;

        const ok = await f.call('PUT', `/api/registros/${NUM}`, cookie, putBody({ estado: 'no_facturada', solicitud: { descuentoPorcentaje: `${descuento},5` } }));
        assert.equal(ok.status, 200, role);
        assert.equal(f.registro().estado, 'no_facturada', role);
        const leido = await f.call('GET', `/api/registros/${NUM}/solicitud`, cookie);
        assert.equal(leido.json.solicitud.descuentoPorcentaje, `${descuento}.5`, role);

        for (const invalido of ['101', '-1', 'abc', '1e1']) {
            const res = await f.call('PUT', `/api/registros/${NUM}`, cookie, putBody({ estado: 'facturada', solicitud: { descuentoPorcentaje: invalido } }));
            assert.equal(res.status, 400, `${role} ${invalido}`);
            assert.match(res.json.message, /DESCUENTO/);
        }
        assert.equal(f.registro().estado, 'no_facturada', role);
        assert.equal(f.solicitud().descuento_porcentaje, `${descuento}.5`, role);
    }

    const vacio = await f.call('PUT', `/api/registros/${NUM}`, await f.loginAs('ADMIN', 'admin2'), putBody({ estado: 'no_facturada', solicitud: { descuentoPorcentaje: '' } }));
    assert.equal(vacio.status, 200);
    assert.equal(f.solicitud().descuento_porcentaje, null);
});

test('admin guarda o rechaza MONTO A FACTURAR y conserva el numero de factura', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('ADMIN');
    const put = (montoFacturar) => f.call('PUT', `/api/registros/${NUM}`, cookie, putBody({ estado: 'facturada', factura: facturaCompleta(montoFacturar) }));

    const ok = await put('$350.000');
    assert.equal(ok.status, 200);
    assert.equal(f.registro().factura_monto, 350000);
    const buscar = await f.call('GET', `/api/registros/buscar?numIngreso=${NUM}`, cookie);
    assert.equal(buscar.json.factura.montoFacturar, '350000.00');
    assert.equal(f.registro().factura_numero, '555');

    for (const invalido of ['abc', '-5', '0']) {
        const res = await put(invalido);
        assert.equal(res.status, 400, invalido);
        assert.equal(res.json.message, 'MONTO A FACTURAR invalido.');
        assert.equal(f.registro().factura_monto, 350000, invalido);
    }

    const vacio = await put('');
    assert.equal(vacio.status, 200);
    assert.equal(f.registro().factura_monto, null);
});

test('ver montos no le da al admin el flujo de factura ni el envio al contador', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('ADMIN');
    assert.equal((await f.call('GET', '/api/facturas/solicitudes', cookie)).status, 403);
    assert.equal((await f.call('GET', `/api/facturas/solicitudes/por-ingreso/${NUM}`, cookie)).status, 403);
    assert.equal((await f.call('POST', '/api/facturas/solicitudes', cookie, {})).status, 403);
    assert.equal((await f.call('POST', '/api/facturas/solicitudes/marcar-enviadas', cookie, {})).status, 403);
    assert.equal((await f.call('POST', '/api/facturas/correo/enviar', cookie, {})).status, 403);
    assert.equal((await f.call('GET', '/api/cotizaciones/resumen', cookie)).status, 403);
});

test('la migracion del descuento agrega la columna una vez y no toca los datos', async (t) => {
    const f = await fixture(t);
    const source = fs.readFileSync(serverFile, 'utf8');
    const definition = /ensureColumn\('registro_solicitud', 'descuento_porcentaje', '([^']+)'\)/.exec(source)?.[1];
    assert.ok(definition, 'initDatabase debe asegurar la columna');
    assert.match(source, /CREATE TABLE IF NOT EXISTS registro_solicitud[\s\S]*?descuento_porcentaje VARCHAR\(6\) NULL/);

    f.db.exec(`DROP TABLE registro_solicitud;
        CREATE TABLE registro_solicitud (registro_id INTEGER PRIMARY KEY, profesional_titulo TEXT);
        INSERT INTO registro_solicitud VALUES (1, 'Ingeniero');`);
    await f.context.ensureColumn('registro_solicitud', 'descuento_porcentaje', definition);
    await f.context.ensureColumn('registro_solicitud', 'descuento_porcentaje', definition);
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM registro_solicitud').get() }, { registro_id: 1, profesional_titulo: 'Ingeniero', descuento_porcentaje: null });
});

test('seguimiento sin movimiento: devuelve todas las carpetas que cumplen la regla, sin tope fijo', async (t) => {
    const f = await fixture(t);
    const hace = (dias) => `datetime('now', '-${dias} days')`;
    // 600 carpetas con solo el ingreso hace 20 dias (ids 101..700) y casos de la regla (ids 2..5).
    f.db.exec(`WITH RECURSIVE seq(n) AS (SELECT 101 UNION ALL SELECT n + 1 FROM seq WHERE n < 700)
            INSERT INTO registros (id, num_ingreso, nombre, documentos, created_by_sucursal) SELECT n, n || '-2026', 'Masivo', '[]', 'Casa Matriz' FROM seq;
        INSERT INTO registro_historial (registro_id, num_ingreso, accion, comentario, usuario_nombre, created_at)
            SELECT id, num_ingreso, 'CREACION', 'creacion y recepcion', 'ana', ${hace(20)} FROM registros WHERE id >= 101;
        INSERT INTO registros (id, num_ingreso, nombre, documentos, created_by_sucursal) VALUES
            (2, '2-2026', 'Retirada', '[]', 'Casa Matriz'), (3, '3-2026', 'Reingresada', '[]', 'Casa Matriz'),
            (4, '4-2026', 'Reingreso reciente', '[]', 'Casa Matriz'), (5, '5-2026', 'Ingreso reciente', '[]', 'Casa Matriz');
        INSERT INTO registro_historial (registro_id, num_ingreso, accion, comentario, usuario_nombre, created_at) VALUES
            (2, '2-2026', 'CREACION', 'creacion y recepcion', 'ana', ${hace(40)}),
            (2, '2-2026', 'COMENTARIO', 'Retira Carpeta Para Subsanar Observaciones', 'ana', ${hace(30)}),
            (3, '3-2026', 'CREACION', 'creacion y recepcion', 'ana', ${hace(60)}),
            (3, '3-2026', 'COMENTARIO', 'Retira Carpeta Para Subsanar Observaciones', 'ana', ${hace(50)}),
            (3, '3-2026', 'COMENTARIO', 'Reingreso de carpeta subsanada', 'ana', ${hace(25)}),
            (4, '4-2026', 'CREACION', 'creacion y recepcion', 'ana', ${hace(60)}),
            (4, '4-2026', 'COMENTARIO', 'Reingreso de carpeta subsanada', 'ana', ${hace(5)}),
            (5, '5-2026', 'CREACION', 'creacion y recepcion', 'ana', ${hace(10)});`);

    const res = await f.call('GET', '/api/registros/seguimiento-sin-movimiento', await f.loginAs('ADMIN'));
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json), ['thresholdDays', 'registros']);
    assert.equal(res.json.thresholdDays, 15);
    assert.equal(res.json.registros.length, 601);

    const numeros = res.json.registros.map((item) => item.numIngreso);
    for (const excluido of ['2-2026', '4-2026', '5-2026', NUM]) assert.equal(numeros.includes(excluido), false, excluido);
    // El reingreso subsanado cuenta desde su fecha (25 dias), no desde el ingreso, y va primero por ser el mas antiguo.
    const reingreso = res.json.registros[0];
    assert.equal(reingreso.numIngreso, '3-2026');
    assert.equal(reingreso.motivo, 'REINGRESO SUBSANADA');
    assert.equal(reingreso.diasSinMovimiento, 25);
    assert.equal(reingreso.totalMovimientos, 3);
    assert.ok(res.json.registros.slice(1).every((item) => item.motivo === 'INGRESO' && item.diasSinMovimiento === 20));
});

test('seguimiento en plazo: es el complemento exacto del listado sin movimiento', async (t) => {
    const f = await fixture(t);
    const hace = (modificador) => `datetime('now', '${modificador}')`;
    // Ingreso unico a varias edades, incluido el borde de 15 dias (un minuto antes, justo y un minuto despues).
    const ingresos = [['21', '-1 days'], ['22', '-14 days'], ['23', '-15 days', '+1 minutes'], ['24', '-15 days'],
        ['25', '-15 days', '-1 minutes'], ['26', '-40 days']];
    f.db.exec(ingresos.map(([id, ...edad], index) => `
        INSERT INTO registros (id, num_ingreso, nombre, documentos, created_by_sucursal) VALUES (${id}, '${id}-2026', 'Ingreso ${index}', '[]', 'Casa Matriz');
        INSERT INTO registro_historial (registro_id, num_ingreso, accion, comentario, usuario_nombre, created_at)
            VALUES (${id}, '${id}-2026', 'CREACION', 'texto libre ${index}', 'ana', datetime('now', ${edad.map((m) => `'${m}'`).join(', ')}));`).join('\n'));
    f.db.exec(`INSERT INTO registros (id, num_ingreso, nombre, documentos, created_by_sucursal) VALUES
            (31, '31-2026', 'Reingreso reciente', '[]', 'Casa Matriz'), (32, '32-2026', 'Reingreso borde', '[]', 'Casa Matriz'),
            (33, '33-2026', 'Reingreso antiguo', '[]', 'Casa Matriz'), (34, '34-2026', 'Retirada', '[]', 'Casa Matriz'),
            (35, '35-2026', 'Con otro movimiento', '[]', 'Casa Matriz');
        INSERT INTO registro_historial (registro_id, num_ingreso, accion, comentario, usuario_nombre, created_at) VALUES
            (31, '31-2026', 'CREACION', 'creacion y recepcion', 'ana', ${hace('-90 days')}),
            (31, '31-2026', 'COMENTARIO', 'Retira Carpeta Para Subsanar Observaciones', 'ana', ${hace('-60 days')}),
            (31, '31-2026', 'COMENTARIO', 'Reingreso de carpeta subsanada', 'ana', ${hace('-3 days')}),
            (32, '32-2026', 'CREACION', 'creacion y recepcion', 'ana', ${hace('-90 days')}),
            (32, '32-2026', 'COMENTARIO', 'Reingreso de carpeta subsanada', 'ana', datetime('now', '-15 days', '+1 minutes')),
            (33, '33-2026', 'CREACION', 'creacion y recepcion', 'ana', ${hace('-90 days')}),
            (33, '33-2026', 'COMENTARIO', 'Reingreso de carpeta subsanada', 'ana', ${hace('-20 days')}),
            (34, '34-2026', 'CREACION', 'creacion y recepcion', 'ana', ${hace('-3 days')}),
            (34, '34-2026', 'COMENTARIO', 'Retira Carpeta Para Subsanar Observaciones', 'ana', ${hace('-2 days')}),
            (35, '35-2026', 'CREACION', 'creacion y recepcion', 'ana', ${hace('-30 days')}),
            (35, '35-2026', 'COMENTARIO', 'Carpeta subsanada parcialmente', 'ana', ${hace('-1 days')});`);

    const token = await f.loginAs('ADMIN');
    const sin = await f.call('GET', '/api/registros/seguimiento-sin-movimiento', token);
    const en = await f.call('GET', '/api/registros/seguimiento-sin-movimiento?alcance=en-plazo', token);
    const otro = await f.call('GET', '/api/registros/seguimiento-sin-movimiento?alcance=otra-cosa', token);
    assert.equal(en.status, 200);
    assert.deepEqual(Object.keys(en.json), ['thresholdDays', 'registros']);
    assert.equal(en.json.thresholdDays, 15);
    assert.deepEqual(otro.json, sin.json);

    const numeros = (res) => res.json.registros.map((item) => item.numIngreso);
    assert.deepEqual(numeros(sin), ['26-2026', '33-2026', '25-2026', '24-2026']);
    assert.deepEqual([...numeros(en)].sort(), ['21-2026', '22-2026', '23-2026', '31-2026', '32-2026']);
    assert.deepEqual(numeros(en).slice(3), ['31-2026', '21-2026']);
    const union = [...numeros(sin), ...numeros(en)];
    assert.equal(new Set(union).size, union.length);
    assert.deepEqual([...union].sort(), ['21-2026', '22-2026', '23-2026', '24-2026', '25-2026', '26-2026', '31-2026',
        '32-2026', '33-2026']);
    // Retirada para subsanar, otro comentario posterior o (NUM) varios movimientos: en ninguno de los dos.
    for (const excluido of ['34-2026', '35-2026', NUM]) assert.equal(union.includes(excluido), false, excluido);

    // Mismo orden (mas dias primero) y mismo formato; el reingreso cuenta desde su fecha, no desde el ingreso.
    const porNumero = Object.fromEntries(en.json.registros.map((item) => [item.numIngreso, item]));
    assert.deepEqual(Object.keys(porNumero['31-2026']), Object.keys(sin.json.registros[0]));
    assert.equal(porNumero['31-2026'].motivo, 'REINGRESO SUBSANADA');
    assert.equal(porNumero['31-2026'].diasSinMovimiento, 3);
    assert.equal(porNumero['32-2026'].diasSinMovimiento, 14);
    assert.equal(porNumero['21-2026'].motivo, 'INGRESO');
    const dias = en.json.registros.map((item) => item.diasSinMovimiento);
    assert.deepEqual(dias, [...dias].sort((a, b) => b - a));

    // El umbral (dias) se respeta igual en los dos listados.
    const sin5 = await f.call('GET', '/api/registros/seguimiento-sin-movimiento?dias=5', token);
    const en5 = await f.call('GET', '/api/registros/seguimiento-sin-movimiento?dias=5&alcance=en-plazo', token);
    assert.equal(en5.json.thresholdDays, 5);
    assert.deepEqual([...numeros(sin5), ...numeros(en5)].sort(), [...union].sort());
    assert.deepEqual(numeros(en5), ['31-2026', '21-2026']);
});

test('el historial se censura tambien en su forma resumida', async (t) => {
    const f = await fixture(t);
    const censurar = f.context.redactFacturaHistoryComment;
    assert.equal(
        censurar('modificacion resumida (6 cambios): registro: nombre, estado de factura | factura: numero, monto a facturar, giro | documentos +1 (plano)'),
        'modificacion resumida (6 cambios): registro: nombre | factura: giro | documentos +1 (plano)'
    );
    assert.equal(censurar('modificacion resumida (6 cambios): factura: numero, monto a facturar +2 mas'), 'modificacion resumida (6 cambios)');
    assert.equal(censurar('modificacion de rol: a -> b | datos de solicitud (provincia, descuento (%))'), 'modificacion de rol: a -> b | datos de solicitud (provincia)');
    assert.equal(censurar('modificacion de datos de solicitud (descuento (%))'), '');
    assert.equal(censurar('modificacion de factura numero: 1 -> 2'), '');
    assert.equal(censurar('modificacion de nombre: a -> b'), 'modificacion de nombre: a -> b');

    // Supervisor y contador: solo se quita el descuento.
    assert.equal(
        censurar('modificacion de estado de factura: a -> b | modificacion de factura numero: 1 -> 2 | datos de solicitud (provincia, descuento (%))', true),
        'modificacion de estado de factura: a -> b | modificacion de factura numero: 1 -> 2 | datos de solicitud (provincia)'
    );
    assert.equal(censurar('modificacion resumida (6 cambios): registro: estado de factura | factura: numero', true), 'modificacion resumida (6 cambios): registro: estado de factura | factura: numero');
    assert.equal(censurar('modificacion de datos de solicitud (descuento (%))', true), '');
});
