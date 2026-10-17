'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Cada sitio declara en assets/site/site.js el nombre de base que le corresponde,
// para no conectarse nunca por error a la base de otra instalación.
function assertDatabaseName(name, pattern) {
    const value = String(name || '');
    if (!/^[a-z0-9_]+$/.test(value) || (pattern && !new RegExp(pattern).test(value))) {
        throw new Error(`DB_NAME "${value}" no corresponde a este sitio${pattern ? ` (se espera ${pattern})` : ''}; se rechaza conectar a bases ajenas.`);
    }
}

// Cada sitio reserva un par de puertos: Node en N (par); N+1 queda para otros usos del sitio.
// La base de datos vive en el MariaDB/MySQL compartido, fuera de este rango.
function assertAppPort(port, rules = {}) {
    const [min, max] = Array.isArray(rules?.portRange) ? rules.portRange : [1, 65535];
    const requireEven = rules?.requireEvenPort === true;
    if (!Number.isInteger(port) || port < min || port > max || (requireEven && port % 2 !== 0)) {
        throw new Error(`PORT debe ser ${requireEven ? 'par ' : ''}entre ${min} y ${max} (ver assets/site/site.js y C:\\SIA\\PUERTOS.md).`);
    }
}

function removeBootstrapCredential(credentialPath) {
    fs.rmSync(credentialPath, { force: true });
}

async function ensureBootstrapAccount(pool, credentialPath) {
    const [existing] = await pool.execute(
        'SELECT id, role, must_change_password FROM usuarios WHERE username = ?', ['admin_sia']
    );
    if (existing.length) {
        if (existing[0].role !== 'SUPER') {
            throw new Error('La cuenta admin_sia existente no es SUPER; revisar la instalación sin alterar sus usuarios.');
        }
        if (!Number(existing[0].must_change_password)) removeBootstrapCredential(credentialPath);
        return { created: false };
    }

    const [counts] = await pool.execute('SELECT COUNT(*) AS total FROM usuarios');
    if (Number(counts[0].total)) {
        // Instalación existente con su propio superusuario: no se crea admin_sia ni se tocan sus cuentas.
        const [supers] = await pool.execute("SELECT COUNT(*) AS total FROM usuarios WHERE role = 'SUPER' AND activo = 1");
        if (Number(supers[0].total)) return { created: false };
        throw new Error('La base de usuarios no está vacía; se cancela el alta inicial para proteger otra instalación.');
    }

    fs.mkdirSync(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
    // Escribir antes del INSERT permite recuperar un arranque interrumpido sin perder la clave.
    if (!fs.existsSync(credentialPath)) {
        fs.writeFileSync(credentialPath, JSON.stringify({
            username: 'admin_sia', password: crypto.randomBytes(24).toString('base64url')
        }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
    const credential = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    if (credential.username !== 'admin_sia' || typeof credential.password !== 'string' || credential.password.length < 20) {
        throw new Error('El archivo de acceso temporal no es válido. Revisar .local/admin_sia.json.');
    }
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(credential.password, salt, 120000, 64, 'sha512').toString('hex');
    await pool.execute(`INSERT INTO usuarios
        (username, nombre, sucursal, role, password_salt, password_hash, must_change_password, activo)
        VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
    ['admin_sia', 'Administrador SIA Core', 'Casa Matriz', 'SUPER', salt.toString('hex'), hash]);
    return { created: true };
}

module.exports = { assertDatabaseName, assertAppPort, ensureBootstrapAccount, removeBootstrapCredential };
