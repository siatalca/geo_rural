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
const clientFile = path.join(__dirname, '../script.js');
const NUM = '10-2026';

// Catalogo esperado: clave -> texto exacto que queda en el historial.
const CATALOGO = {
    retira_subsanar: 'Retira Carpeta Para Subsanar Observaciones',
    reingreso_subsanado: 'Reingresa Carpeta Con Observaciones Subsanadas',
    sale_sag: 'Sale Al Sag',
    regresa_sag: 'Regresa Del Sag',
    notificacion_hallazgos: 'Notificacion De Hallazgos'
};

// Mismo adaptador MySQL -> SQLite que tests/descuento-factura.test.js, mas SHOW INDEX / ADD INDEX para la migracion.
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
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-indicadores-'));
    const credentialPath = path.join(directory, '.local/admin_sia.json');
    const db = new DatabaseSync(':memory:');
    // registro_historial sin la columna indicador: la crea la migracion, como en una base existente.
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
    // La migracion corre en cada arranque.
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

    db.exec(`INSERT INTO registros (id, num_ingreso, correlativo, anio, nombre, estado, comentario, documentos, created_by_sucursal)
            VALUES (1, '${NUM}', 10, 2026, 'Ana', 'facturada', 'x', '[]', 'Casa Matriz');
        INSERT INTO registro_historial (registro_id, num_ingreso, accion, comentario, usuario_nombre, created_at) VALUES
            (1, '${NUM}', 'CREACION', 'creacion y recepcion', 'ana', datetime('now', '-40 days')),
            (1, '${NUM}', 'FACTURA', 'factura folio 555 adjuntada (emitida 2026-01-25)', 'ana', datetime('now', '-30 days'));`);

    const historial = () => db.prepare('SELECT * FROM registro_historial WHERE registro_id = 1 ORDER BY id').all();
    return { db, call, loginAs, context, historial };
}

const indicar = (f, cookie, indicador, num = NUM) => f.call('POST', `/api/registros/${num}/indicador`, cookie, { indicador });

test('indicador: las 5 claves guardan el texto exacto, la clave y el usuario como un comentario', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('OPERADOR');

    for (const [clave, texto] of Object.entries(CATALOGO)) {
        const res = await indicar(f, cookie, clave);
        assert.equal(res.status, 201, clave);
        assert.deepEqual(res.json, { message: 'Comentario indicador guardado correctamente.', numIngreso: NUM, indicador: clave, comentario: texto });
        const ultimo = f.historial().at(-1);
        assert.equal(ultimo.accion, 'COMENTARIO');
        assert.equal(ultimo.comentario, texto);
        assert.equal(ultimo.indicador, clave);
        assert.equal(ultimo.usuario_nombre, 'operador');
        assert.equal(ultimo.sucursal, 'Casa Matriz');
        assert.equal(f.db.prepare('SELECT comentario FROM registros WHERE id = 1').get().comentario, texto);
    }
});

test('indicador: clave fuera del catalogo, registro inexistente o ingreso invalido se rechazan', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('SECRETARIA');
    const antes = f.historial().length;

    for (const clave of ['', 'otra', 'SALE_SAG', 'toString', '__proto__', 'hasOwnProperty']) {
        const res = await indicar(f, cookie, clave);
        assert.equal(res.status, 400, `clave "${clave}"`);
    }
    assert.equal((await f.call('POST', `/api/registros/${NUM}/indicador`, cookie, {})).status, 400);
    assert.equal((await f.call('POST', `/api/registros/${NUM}/indicador`, cookie, { indicador: ['sale_sag'] })).status, 400);
    assert.equal((await indicar(f, cookie, 'sale_sag', '999-2026')).status, 404);
    assert.equal((await indicar(f, cookie, 'sale_sag', 'abc')).status, 400);
    assert.equal(f.historial().length, antes);
});

test('indicador: OPERADOR, SECRETARIA y SUPER pueden; SUPERVISOR, CONTADOR, ADMIN, invitado y sin sesion no', async (t) => {
    const f = await fixture(t);
    const antes = f.historial().length;
    assert.equal((await indicar(f, '', 'sale_sag')).status, 401);
    for (const role of ['SUPERVISOR', 'CONTADOR', 'ADMIN']) {
        const res = await indicar(f, await f.loginAs(role), 'sale_sag');
        assert.equal(res.status, 403, role);
        assert.deepEqual(Object.keys(res.json), ['message']);
    }
    assert.equal((await indicar(f, await f.loginAs('SECRETARIA', 'invitado'), 'sale_sag')).status, 403);
    assert.equal(f.historial().length, antes);

    // Alternan claves para no chocar con la proteccion de doble clic.
    const permitidos = [['OPERADOR', 'sale_sag'], ['SECRETARIA', 'regresa_sag'], ['SUPER', 'notificacion_hallazgos']];
    for (const [role, clave] of permitidos) {
        const res = await indicar(f, await f.loginAs(role, `${role.toLowerCase()}2`), clave);
        assert.equal(res.status, 201, role);
        assert.equal(f.historial().at(-1).usuario_nombre, `${role.toLowerCase()}2`);
    }
});

test('indicador: rige el rol activo de la sesion, no el rol secundario', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('ADMIN', 'doble');
    f.db.prepare("UPDATE usuarios SET role_secundario = 'SECRETARIA' WHERE username = 'doble'").run();
    assert.equal((await indicar(f, cookie, 'sale_sag')).status, 403);
    f.db.prepare("UPDATE sesiones SET active_role = 'SECRETARIA'").run();
    assert.equal((await indicar(f, cookie, 'sale_sag')).status, 201);
});

test('indicador: doble registro consecutivo da 409; despues de otro movimiento se acepta', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('OPERADOR');

    assert.equal((await indicar(f, cookie, 'sale_sag')).status, 201);
    const total = f.historial().length;
    const repetido = await indicar(f, cookie, 'sale_sag');
    assert.equal(repetido.status, 409);
    assert.match(repetido.json.message, /Sale Al Sag/);
    assert.equal(f.historial().length, total);

    // Otro indicador o un comentario escrito a mano cuentan como otro movimiento.
    assert.equal((await indicar(f, cookie, 'regresa_sag')).status, 201);
    assert.equal((await indicar(f, cookie, 'sale_sag')).status, 201);
    const comentario = await f.call('POST', `/api/registros/${NUM}/comentario`, cookie, { comentario: 'Llamar Al Cliente' });
    assert.equal(comentario.status, 200);
    assert.equal((await indicar(f, cookie, 'sale_sag')).status, 201);
    assert.deepEqual(f.historial().slice(-5).map((row) => row.indicador), ['sale_sag', 'regresa_sag', 'sale_sag', null, 'sale_sag']);
});

test('comentario normal: misma respuesta de siempre y sin indicador', async (t) => {
    const f = await fixture(t);
    const cookie = await f.loginAs('SUPERVISOR');
    const res = await f.call('POST', `/api/registros/${NUM}/comentario`, cookie, { comentario: 'Sale Al Sag' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: 'Comentario guardado correctamente.', numIngreso: NUM });
    assert.equal(f.historial().at(-1).indicador, null);
    // Un comentario escrito igual al del boton no bloquea el boton: el doble clic se mide por indicador.
    assert.equal((await indicar(f, await f.loginAs('OPERADOR'), 'sale_sag')).status, 201);
    assert.equal((await f.call('POST', `/api/registros/${NUM}/comentario`, cookie, { comentario: '' })).status, 400);
});

test('historial: incluye indicador (null en comentarios normales) y sigue censurado para los roles que corresponde', async (t) => {
    const f = await fixture(t);
    const operador = await f.loginAs('OPERADOR');
    await f.call('POST', `/api/registros/${NUM}/comentario`, operador, { comentario: 'Llamar Al Cliente' });
    await indicar(f, operador, 'sale_sag');

    for (const role of ['OPERADOR', 'SUPERVISOR', 'CONTADOR', 'SECRETARIA', 'ADMIN', 'SUPER']) {
        const cookie = role === 'OPERADOR' ? operador : await f.loginAs(role);
        const res = await f.call('GET', `/api/registros/${NUM}/historial`, cookie);
        assert.equal(res.status, 200, role);
        const porComentario = Object.fromEntries(res.json.historial.map((h) => [h.comentario, h.indicador]));
        assert.equal(porComentario['Sale Al Sag'], 'sale_sag', role);
        assert.equal(porComentario['Llamar Al Cliente'], null, role);
        assert.equal(porComentario['creacion y recepcion'], null, role);
        assert.ok(res.json.historial.every((h) => 'indicador' in h), role);
        // La fila FACTURA solo la ven quienes acceden a datos de factura.
        const veFactura = res.json.historial.some((h) => h.accion === 'FACTURA');
        assert.equal(veFactura, ['SUPERVISOR', 'CONTADOR', 'SECRETARIA', 'ADMIN', 'SUPER'].includes(role), role);
    }
});

test('reingreso por boton: la carpeta vuelve a contar en seguimiento sin movimiento desde esa fecha', async (t) => {
    const f = await fixture(t);
    f.db.exec(`INSERT INTO registros (id, num_ingreso, nombre, documentos, created_by_sucursal) VALUES (2, '2-2026', 'Retirada', '[]', 'Casa Matriz');
        INSERT INTO registro_historial (registro_id, num_ingreso, accion, comentario, usuario_nombre, created_at) VALUES
            (2, '2-2026', 'CREACION', 'creacion y recepcion', 'ana', datetime('now', '-60 days')),
            (2, '2-2026', 'COMENTARIO', 'creacion y recepcion', 'ana', datetime('now', '-59 days'));`);
    const cookie = await f.loginAs('SECRETARIA');
    const listar = async (alcance = '') => (await f.call('GET', `/api/registros/seguimiento-sin-movimiento${alcance}`, cookie)).json.registros;

    // Retira por boton: deja de contar en los dos listados.
    assert.equal((await indicar(f, cookie, 'retira_subsanar', '2-2026')).status, 201);
    assert.equal([...await listar(), ...await listar('?alcance=en-plazo')].some((r) => r.numIngreso === '2-2026'), false);

    // Reingresa por boton: cuenta desde hoy (en plazo) como REINGRESO SUBSANADA.
    assert.equal((await indicar(f, cookie, 'reingreso_subsanado', '2-2026')).status, 201);
    assert.equal((await listar()).some((r) => r.numIngreso === '2-2026'), false);
    const enPlazo = (await listar('?alcance=en-plazo')).find((r) => r.numIngreso === '2-2026');
    assert.ok(enPlazo);
    assert.equal(enPlazo.motivo, 'REINGRESO SUBSANADA');
    assert.equal(enPlazo.diasSinMovimiento, 0);
    assert.equal(enPlazo.totalMovimientos, 4);

    // Pasado el plazo aparece en sin movimiento, contando desde la fecha del reingreso.
    f.db.exec(`UPDATE registro_historial SET created_at = datetime('now', '-30 days') WHERE indicador = 'retira_subsanar';
        UPDATE registro_historial SET created_at = datetime('now', '-20 days') WHERE indicador = 'reingreso_subsanado';`);
    const vencida = (await listar()).find((r) => r.numIngreso === '2-2026');
    assert.ok(vencida);
    assert.equal(vencida.diasSinMovimiento, 20);
    assert.equal(f.context.isReingresoSubsanadaComment(CATALOGO.reingreso_subsanado), true);
});

test('migracion: crea indicador e indice una sola vez y no toca los datos', async (t) => {
    const f = await fixture(t);
    const antes = f.historial();
    await f.context.ensureHistoryIndicadorColumn();
    await f.context.ensureHistoryIndicadorColumn();

    const columnas = f.db.prepare('PRAGMA table_info(registro_historial)').all().filter((c) => c.name === 'indicador');
    assert.equal(columnas.length, 1);
    assert.equal(columnas[0].type, 'VARCHAR(30)');
    assert.equal(columnas[0].notnull, 0);
    const indice = f.db.prepare('PRAGMA index_list(registro_historial)').all().filter((i) => i.name === 'idx_historial_indicador_fecha');
    assert.equal(indice.length, 1);
    assert.deepEqual(f.db.prepare('PRAGMA index_info(idx_historial_indicador_fecha)').all().map((c) => c.name), ['indicador', 'created_at']);
    assert.deepEqual(f.historial(), antes);
});

test('catalogo: los textos quedan igual que un comentario escrito a mano (formatComentarioTitleCase del cliente)', () => {
    const source = fs.readFileSync(clientFile, 'utf8');
    const match = /function formatComentarioTitleCase\(value\) \{[\s\S]*?\n\}/.exec(source);
    assert.ok(match, 'formatComentarioTitleCase existe en script.js');
    const format = vm.runInNewContext(`(${match[0]})`);
    for (const texto of Object.values(CATALOGO)) {
        assert.equal(format(texto), texto);
    }
});
