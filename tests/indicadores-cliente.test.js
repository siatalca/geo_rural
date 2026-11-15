const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Carga las funciones reales de permiso por rol desde script.js (cliente).
function loadClientRoleFunctions() {
    const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
    const names = ['normalizeUserRole', 'isSuperUser', 'isSecretaryUser', 'isOperatorUser', 'isGuestUser', 'canUseHistorialIndicadores'];
    const code = names.map((name) => {
        const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
        assert.ok(match, `Función real ${name}`);
        return match[0];
    }).join('\n');
    const context = {};
    vm.runInNewContext(code, context);
    return context;
}

test('botones de indicador: solo OPERADOR, SECRETARIA y SUPER', () => {
    const c = loadClientRoleFunctions();
    const roles = ['OPERADOR', 'SECRETARIA', 'SUPER', 'SUPERVISOR', 'ADMIN', 'CONTADOR'];
    assert.deepEqual(roles.map((role) => c.canUseHistorialIndicadores({ role, username: 'x' })), [true, true, true, false, false, false]);
    assert.equal(c.canUseHistorialIndicadores({ role: 'OPERADOR', isGuest: true }), false);
    assert.equal(c.canUseHistorialIndicadores(null), false);
});

test('la ficha trae los cinco botones con la clave del contrato y su title', () => {
    const html = fs.readFileSync(path.join(__dirname, '../registro/login/registro.html'), 'utf8');
    const esperados = {
        retira_subsanar: 'RETIRA PARA SUBSANAR',
        reingreso_subsanado: 'REINGRESO SUBSANADO',
        sale_sag: 'SALE AL SAG',
        regresa_sag: 'REGRESA DEL SAG',
        notificacion_hallazgos: 'NOTIFICACIÓN DE HALLAZGOS'
    };
    const encontrados = {};
    const re = /<button[^>]*class="indicador-btn"[^>]*data-indicador="([a-z_]+)"[^>]*title="([^"]+)"[^>]*>([^<]+)<\/button>/g;
    let match;
    while ((match = re.exec(html)) !== null) {
        encontrados[match[1]] = match[3].trim();
    }
    assert.deepEqual(encontrados, esperados);
});
