const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// SQL real sobre una base efímera; no se abre MySQL ni el entorno del cliente.
function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-core-test-'));
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY, username TEXT UNIQUE, nombre TEXT, sucursal TEXT,
        role TEXT, password_salt TEXT, password_hash TEXT,
        must_change_password INTEGER, activo INTEGER
    )`);
    const pool = {
        async execute(sql, values = []) {
            const statement = db.prepare(sql);
            return /^\s*SELECT/i.test(sql) ? [statement.all(...values)] : [statement.run(...values)];
        }
    };
    t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    return { db, pool, directory, credentialPath: path.join(directory, 'admin_sia.json') };
}

function subject() {
    const filename = path.join(__dirname, '../server/bootstrap.js');
    assert.ok(fs.existsSync(filename), 'Debe existir el inicializador seguro de SIA Core');
    return require(filename);
}

test('el primer arranque crea solo admin_sia y exige cambiar la clave', async (t) => {
    const f = fixture(t);
    await subject().ensureBootstrapAccount(f.pool, f.credentialPath);
    const users = f.db.prepare('SELECT * FROM usuarios').all();
    assert.equal(users.length, 1);
    assert.equal(users[0].username, 'admin_sia');
    assert.equal(users[0].role, 'SUPER');
    assert.equal(users[0].must_change_password, 1);
    const credential = JSON.parse(fs.readFileSync(f.credentialPath, 'utf8'));
    assert.ok(credential.password.length >= 20);
    assert.notEqual(users[0].password_hash, credential.password);
    assert.equal(crypto.pbkdf2Sync(credential.password, Buffer.from(users[0].password_salt, 'hex'), 120000, 64, 'sha512').toString('hex'), users[0].password_hash);
});

test('reiniciar antes del cambio conserva la clave y la obligación de cambiarla', async (t) => {
    const f = fixture(t);
    await subject().ensureBootstrapAccount(f.pool, f.credentialPath);
    const before = f.db.prepare('SELECT * FROM usuarios').get();
    const credential = fs.readFileSync(f.credentialPath, 'utf8');
    await subject().ensureBootstrapAccount(f.pool, f.credentialPath);
    assert.deepEqual(f.db.prepare('SELECT * FROM usuarios').get(), before);
    assert.equal(fs.readFileSync(f.credentialPath, 'utf8'), credential);
});

test('reiniciar después del cambio no restablece contraseña ni privilegios', async (t) => {
    const f = fixture(t);
    await subject().ensureBootstrapAccount(f.pool, f.credentialPath);
    f.db.exec("UPDATE usuarios SET must_change_password=0, password_hash='nuevo-hash', activo=0");
    await subject().ensureBootstrapAccount(f.pool, f.credentialPath);
    const user = f.db.prepare('SELECT * FROM usuarios').get();
    assert.equal(user.password_hash, 'nuevo-hash');
    assert.equal(user.must_change_password, 0);
    assert.equal(user.activo, 0);
    assert.equal(fs.existsSync(f.credentialPath), false);
});

test('rechaza una base ya ocupada por otra instalación', async (t) => {
    const f = fixture(t);
    f.db.exec("INSERT INTO usuarios (username,role) VALUES ('otro','ADMIN')");
    await assert.rejects(subject().ensureBootstrapAccount(f.pool, f.credentialPath), /no está vacía/);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM usuarios').get().n, 1);
    assert.equal(fs.existsSync(f.credentialPath), false);
});

test('una base existente con su propio SUPER se respeta sin crear admin_sia', async (t) => {
    const f = fixture(t);
    f.db.exec("INSERT INTO usuarios (username,role,activo) VALUES ('superusuario','SUPER',1), ('caja','SECRETARIA',1)");
    assert.deepEqual(await subject().ensureBootstrapAccount(f.pool, f.credentialPath), { created: false });
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM usuarios').get().n, 2);
    assert.equal(fs.existsSync(f.credentialPath), false);
});

test('rechaza bases ajenas antes de conectar', () => {
    const pattern = '^sia_core(?:_[a-z0-9]+)*$';
    for (const name of ['geo_rural', 'mysql', '', 'sia_core;DROP', 'sia-core']) {
        assert.throws(() => subject().assertDatabaseName(name, pattern), /DB_NAME/);
    }
    assert.doesNotThrow(() => subject().assertDatabaseName('sia_core', pattern));
    assert.doesNotThrow(() => subject().assertDatabaseName('sia_core_empresa1', pattern));
    assert.throws(() => subject().assertDatabaseName('sia_core', '^geo_rural$'), /DB_NAME/);
});

test('la base por defecto de este sitio cumple su propio patrón', () => {
    const site = require('../assets/site/site.js');
    assert.doesNotThrow(() => subject().assertDatabaseName(site.database.defaultName, site.database.namePattern));
});

test('con regla de pares solo se aceptan puertos pares dentro del rango del sitio', () => {
    const { assertAppPort } = subject();
    const rules = { portRange: [3100, 3198], requireEvenPort: true };
    for (const port of [3000, 3099, 3101, 3199, 3200, 3100.5, NaN]) assert.throws(() => assertAppPort(port, rules), /3100.*3198/);
    for (const port of [3100, 3130, 3198]) assert.doesNotThrow(() => assertAppPort(port, rules));
    assert.doesNotThrow(() => assertAppPort(3001, { portRange: null, requireEvenPort: false }));
});

test('el puerto por defecto de este sitio cumple su propia regla', () => {
    const site = require('../assets/site/site.js');
    assert.doesNotThrow(() => subject().assertAppPort(site.server.defaultPort, site.server));
});
