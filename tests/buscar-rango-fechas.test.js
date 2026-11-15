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

// Mismo adaptador MySQL -> SQLite que tests/reportes.test.js.
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
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-rango-fechas-'));
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

    function registro(id, num, createdAt, { region = 'Maule' } = {}) {
        db.prepare(`INSERT INTO registros (id, num_ingreso, nombre, rut, region, comuna, num_lotes, estado_carpeta, documentos,
            created_by_sucursal, created_at) VALUES (?, ?, ?, '1-9', ?, 'Talca', 2, 'recibido', '[]', 'Casa Matriz', ?)`)
            .run(id, num, `Cliente ${num}`, region, createdAt);
    }

    return { db, get, loginAs, registro };
}

// 351 carpetas repartidas en 2026, como en Geo Rural. Varias comparten dia y hora para probar el desempate por id.
// La primera entra el primer segundo del anio y la ultima el ultimo segundo; 400 y 401 quedan fuera por un segundo.
function seedAnio(f) {
    const carpetas = [];
    for (let id = 1; id <= 351; id += 1) {
        const dia = new Date(Date.UTC(2026, 0, 1) + Math.floor((id - 1) / 3) * 3 * 86400000).toISOString().slice(0, 10);
        let createdAt = `${dia} 10:00:00`;
        if (id === 1) createdAt = '2026-01-01 00:00:00';
        if (id === 351) createdAt = '2026-12-31 23:59:59';
        carpetas.push({ id, num: `${id}-2026`, createdAt });
    }
    // Se insertan desordenadas para que el orden salga de la consulta y no del orden de insercion.
    for (const c of carpetas.slice().reverse().filter((_, i) => i % 2 === 0)) f.registro(c.id, c.num, c.createdAt);
    for (const c of carpetas.slice().reverse().filter((_, i) => i % 2 === 1)) f.registro(c.id, c.num, c.createdAt);
    f.registro(400, '400-2025', '2025-12-31 23:59:59');
    f.registro(401, '401-2027', '2027-01-01 00:00:00');
    return carpetas;
}

const ruta = (desde, hasta) => `/api/registros/buscar-rango-fechas?fechaDesde=${desde}&fechaHasta=${hasta}`;
const nums = (res) => res.json.registros.map((r) => r.numIngreso);
// Orden de la respuesta: created_at DESC, id DESC.
const ordenEsperado = (lista) => lista.slice()
    .sort((a, b) => (a.createdAt === b.createdAt ? b.id - a.id : (a.createdAt < b.createdAt ? 1 : -1)))
    .map((c) => c.num);

test('buscar-rango-fechas: el anio completo trae las 351 carpetas, sin tope de 300', async (t) => {
    const f = await fixture(t);
    const carpetas = seedAnio(f);
    for (const role of ['OPERADOR', 'SUPERVISOR', 'SECRETARIA', 'SUPER']) {
        const res = await f.get(ruta('2026-01-01', '2026-12-31'), await f.loginAs(role));
        assert.equal(res.status, 200, role);
        assert.equal(res.json.registros.length, 351, role);
        assert.deepEqual(nums(res), ordenEsperado(carpetas), role);
        // Las primeras carpetas del anio, que antes quedaban fuera, estan al final.
        assert.deepEqual(nums(res).slice(-3), ['3-2026', '2-2026', '1-2026'], role);
    }
});

test('buscar-rango-fechas: los bordes del rango son inclusive por dia', async (t) => {
    const f = await fixture(t);
    const carpetas = seedAnio(f);
    const cookie = await f.loginAs('SUPERVISOR');
    const delDia = (dia) => ordenEsperado(carpetas.filter((c) => c.createdAt.startsWith(dia)));

    assert.deepEqual(nums(await f.get(ruta('2026-01-01', '2026-01-01'), cookie)), delDia('2026-01-01'));
    assert.ok(delDia('2026-01-01').includes('1-2026'));
    assert.deepEqual(nums(await f.get(ruta('2026-12-31', '2026-12-31'), cookie)), delDia('2026-12-31'));
    assert.ok(delDia('2026-12-31').includes('351-2026'));
    assert.deepEqual(nums(await f.get(ruta('2025-12-31', '2025-12-31'), cookie)), ['400-2025']);
    assert.deepEqual(nums(await f.get(ruta('2027-01-01', '2027-01-01'), cookie)), ['401-2027']);

    // Un rango que cruza el cambio de anio toma los dos bordes exteriores.
    const cruce = nums(await f.get(ruta('2025-12-31', '2026-01-01'), cookie));
    assert.deepEqual(cruce, [...delDia('2026-01-01'), '400-2025']);
    const todo = await f.get(ruta('2025-01-01', '2027-12-31'), cookie);
    assert.equal(todo.json.registros.length, 353);
    assert.equal(nums(todo)[0], '401-2027');
    assert.equal(nums(todo).at(-1), '400-2025');
});

test('buscar-rango-fechas: mismo orden y formato de cada carpeta', async (t) => {
    const f = await fixture(t);
    const carpetas = seedAnio(f);
    const cookie = await f.loginAs('OPERADOR');
    const res = await f.get(ruta('2026-03-01', '2026-03-31'), cookie);
    const marzo = carpetas.filter((c) => c.createdAt.startsWith('2026-03'));
    assert.ok(marzo.length > 1);
    assert.deepEqual(nums(res), ordenEsperado(marzo));
    assert.deepEqual(Object.keys(res.json), ['registros']);
    assert.deepEqual(Object.keys(res.json.registros[0]), ['numIngreso', 'nombre', 'rut', 'rol', 'numLotes', 'telefono', 'correo',
        'region', 'comuna', 'sucursal', 'estadoCarpeta', 'createdAt']);
    // Con dia y hora iguales desempata el id mayor primero.
    const empatados = res.json.registros.filter((r) => r.createdAt === res.json.registros[0].createdAt).map((r) => Number.parseInt(r.numIngreso, 10));
    assert.ok(empatados.length > 1);
    assert.deepEqual(empatados, empatados.slice().sort((a, b) => b - a));
});
