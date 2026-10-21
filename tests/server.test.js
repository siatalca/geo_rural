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

async function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-core-http-'));
    const credentialPath = path.join(directory, '.local/admin_sia.json');
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, username TEXT UNIQUE, nombre TEXT, sucursal TEXT,
        role TEXT, role_secundario TEXT, password_salt TEXT, password_hash TEXT, must_change_password INTEGER, activo INTEGER,
        onboarding_pending INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT);
        CREATE TABLE sesiones (id INTEGER PRIMARY KEY, user_id INTEGER, active_role TEXT, token_hash TEXT,
        expires_at TEXT, absolute_expires_at TEXT, last_used_at TEXT, revoked_at TEXT);
        CREATE TABLE sistema_configuracion (id INTEGER PRIMARY KEY, folder_status_groups TEXT, folder_status_options TEXT);`);
    // Solo se adapta la sintaxis de fechas MySQL; las consultas y los datos se ejecutan realmente.
    const pool = { async execute(sql, values = []) {
        sql = sql.replaceAll('DATE_ADD(NOW(), INTERVAL ? HOUR)', "datetime('now', '+' || ? || ' hours')")
            .replaceAll('NOW()', "datetime('now')").replaceAll('LEAST(', 'MIN(');
        const stmt = db.prepare(sql);
        if (/^\s*SELECT/i.test(sql)) return [stmt.all(...values)];
        const result = stmt.run(...values);
        return [{ insertId: Number(result.lastInsertRowid), affectedRows: result.changes }];
    } };
    pool.query = pool.execute;
    await ensureBootstrapAccount(pool, credentialPath);
    const credential = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    const serverFile = path.join(__dirname, '../server/server.js');
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
        console, Buffer, URL, setTimeout, clearTimeout, testPool: pool
    };
    vm.runInNewContext(fs.readFileSync(serverFile, 'utf8') + '\npool = testPool;', context, { filename: serverFile });
    const server = context.module.exports.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        db.close(); fs.rmSync(directory, { recursive: true, force: true });
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function request(route, body, cookie = '') {
        return fetch(origin + route, {
            method: body ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
    }
    request.origin = origin;
    async function login(password = credential.password) {
        const response = await request('/api/auth/login', { username: 'admin_sia', password });
        return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
    }
    return { db, request, login, credential, credentialPath, pool };
}

test('la API bloquea al SUPER con clave temporal, permite cambiarla y rechaza la anterior', async (t) => {
    const f = await fixture(t);
    const { response, cookie } = await f.login();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.mustChangePassword, true);
    assert.match(cookie, /^sia_core_session=/);
    const blocked = await f.request('/api/carpeta-estados/catalogo', null, cookie);
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, 'PASSWORD_CHANGE_REQUIRED');
    const same = await f.request('/api/auth/change-password', { currentPassword: f.credential.password, newPassword: f.credential.password }, cookie);
    assert.equal(same.status, 400);
    const otherSession = await f.login();
    const changed = await f.request('/api/auth/change-password', { currentPassword: f.credential.password, newPassword: 'Nueva-para-prueba-8392!' }, cookie);
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).user.mustChangePassword, false);
    assert.equal(fs.existsSync(f.credentialPath), false);
    assert.equal((await f.request('/api/carpeta-estados/catalogo', null, cookie)).status, 200);
    assert.equal((await f.request('/api/auth/me', null, otherSession.cookie)).status, 401);
    assert.equal((await f.login()).response.status, 401);
    assert.equal((await f.login('Nueva-para-prueba-8392!')).response.status, 200);
});

test('pedir acceso de invitado no crea una segunda cuenta', async (t) => {
    const f = await fixture(t);
    assert.equal((await f.request('/api/auth/guest', {})).status, 403);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM usuarios').get().n, 1);
});

test('sin sesión no se pueden consultar datos internos', async (t) => {
    const f = await fixture(t);
    assert.equal((await f.request('/api/admin/usuarios')).status, 401);
});

test('la guía aparece después del cambio, persiste al reconectar y se cierra por usuario', async (t) => {
    const f = await fixture(t);
    const { cookie } = await f.login();
    assert.equal((await f.request('/api/auth/onboarding-complete', {}, cookie)).status, 403);
    const password = 'Nueva-para-guia-8392!';
    const changed = await f.request('/api/auth/change-password', { currentPassword: f.credential.password, newPassword: password }, cookie);
    const changedBody = await changed.json();
    assert.equal(changedBody.user.onboardingPending, true);
    const reconnected = await f.login(password);
    assert.equal((await reconnected.response.json()).user.onboardingPending, true);
    const completed = await f.request('/api/auth/onboarding-complete', {}, reconnected.cookie);
    assert.equal(completed.status, 200);
    assert.equal(f.db.prepare('SELECT onboarding_pending FROM usuarios').get().onboarding_pending, 0);
    assert.equal((await (await f.login(password)).response.json()).user.onboardingPending, false);
});

test('restablecer una clave temporal vuelve a activar la guía después de cambiarla', async (t) => {
    const f = await fixture(t);
    const password = 'Primera-definitiva-8392!';
    const first = await f.login();
    await f.request('/api/auth/change-password', { currentPassword: f.credential.password, newPassword: password }, first.cookie);
    await f.request('/api/auth/onboarding-complete', {}, first.cookie);
    const temporary = 'Temporal-restablecida-8392!';
    const reset = await f.request('/api/admin/usuarios/1/reset-password', { newPassword: temporary }, first.cookie);
    assert.equal(reset.status, 200);
    const login = await f.login(temporary);
    assert.equal((await login.response.json()).user.mustChangePassword, true);
    const changed = await f.request('/api/auth/change-password', { currentPassword: temporary, newPassword: 'Segunda-definitiva-8392!' }, login.cookie);
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).user.onboardingPending, true);
});

// Crea un usuario de prueba con uno o dos roles e inicia su sesión.
async function loginAs(f, username, role, roleSecundario = null) {
    const password = 'Clave-de-prueba-8392!';
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
    f.db.prepare(`INSERT INTO usuarios (username, nombre, sucursal, role, role_secundario, password_salt, password_hash, must_change_password, activo, onboarding_pending)
        VALUES (?, ?, 'Casa Matriz', ?, ?, ?, ?, 0, 1, 0)`).run(username, username, role, roleSecundario, salt.toString('hex'), hash);
    const response = await f.request('/api/auth/login', { username, password });
    return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

test('un usuario con dos roles elige con cuál trabaja y no puede tomar otro', async (t) => {
    const f = await fixture(t);
    const { response, cookie } = await loginAs(f, 'karla', 'SECRETARIA', 'CONTADOR');
    const user = (await response.json()).user;
    assert.equal(user.role, 'SECRETARIA');
    assert.deepEqual(user.roles, ['SECRETARIA', 'CONTADOR']);
    assert.equal((await f.request('/api/auth/rol-activo', { role: 'CONTADOR' }, cookie)).status, 200);
    const me = await (await f.request('/api/auth/me', null, cookie)).json();
    assert.equal(me.user.role, 'CONTADOR');
    assert.equal((await f.request('/api/auth/rol-activo', { role: 'SUPER' }, cookie)).status, 400);
    assert.equal((await (await f.request('/api/auth/me', null, cookie)).json()).user.role, 'CONTADOR');
});

test('el SUPER ve como otro rol con sus permisos y vuelve a SUPER', async (t) => {
    const f = await fixture(t);
    const password = 'Nueva-para-ver-como-8392!';
    const first = await f.login();
    await f.request('/api/auth/change-password', { currentPassword: f.credential.password, newPassword: password }, first.cookie);
    await f.request('/api/auth/onboarding-complete', {}, first.cookie);
    const { cookie } = await f.login(password);
    assert.equal((await f.request('/api/admin/usuarios', null, cookie)).status, 200);
    assert.equal((await f.request('/api/auth/rol-activo', { role: 'OPERADOR' }, cookie)).status, 200);
    assert.equal((await (await f.request('/api/auth/me', null, cookie)).json()).user.role, 'OPERADOR');
    assert.equal((await f.request('/api/admin/usuarios', null, cookie)).status, 403);
    assert.equal((await f.request('/api/auth/rol-activo', { role: 'SUPER' }, cookie)).status, 200);
    assert.equal((await f.request('/api/admin/usuarios', null, cookie)).status, 200);
});

test('SUPER no se combina y un rol adicional repetido se ignora', async (t) => {
    const f = await fixture(t);
    const combinado = await loginAs(f, 'jefe', 'SUPERVISOR', 'SUPERVISOR');
    assert.deepEqual((await combinado.response.json()).user.roles, ['SUPERVISOR']);
});

test('solo Contador, Secretaria y Super pueden subir facturas; un archivo que no es PDF no se guarda', async (t) => {
    const f = await fixture(t);
    const upload = (cookie, body = 'no es un pdf') =>
        fetch(f.request.origin + '/api/facturas/solicitudes/1/documento', {
            method: 'POST',
            headers: { 'Content-Type': 'application/pdf', 'X-Factura-Folio': '1543', 'X-Factura-Fecha': '2026-01-15', Cookie: cookie },
            body
        });
    const operador = await loginAs(f, 'pedro', 'OPERADOR');
    assert.equal((await upload(operador.cookie)).status, 403);
    const supervisor = await loginAs(f, 'sofia', 'SUPERVISOR');
    assert.equal((await upload(supervisor.cookie)).status, 403);
    const contador = await loginAs(f, 'carla', 'CONTADOR');
    const invalido = await upload(contador.cookie);
    assert.equal(invalido.status, 400);
    assert.match((await invalido.json()).message, /PDF valido/);
    assert.equal((await fetch(f.request.origin + '/api/facturas/solicitudes/1/documento', { headers: { Cookie: operador.cookie } })).status, 403);
});

test('cada panel solo lo ve su rol', async (t) => {
    const f = await fixture(t);
    const secretaria = await loginAs(f, 'ana', 'SECRETARIA');
    assert.equal((await f.request('/api/contador/resumen', null, secretaria.cookie)).status, 403);
    const contador = await loginAs(f, 'carla', 'CONTADOR');
    assert.equal((await f.request('/api/supervisor/resumen', null, contador.cookie)).status, 403);
});
