const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Las expectativas salen de la configuración de este sitio (assets/site/site.js).
const site = require('../assets/site/site.js');
const [minPort, maxPort] = site.api.portRange;
const local = site.api.localPort;
const foreignPort = minPort > 3001 ? 3001 : 3104;

function resolveFrom(pageUrl, override = '') {
    const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
    const names = ['normalizeApiBase', 'getApiBaseOverride', 'isLoopbackHost', 'getSiteApiLocalPort', 'isSiteApiPort', 'sanitizeApiBaseOverride', 'resolveApiBase'];
    const functions = names.map(name => {
        const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
        assert.ok(match, `Función real ${name}`);
        return match[0];
    }).join('\n');
    const window = { SITE_CONFIG: site, location: new URL(pageUrl), localStorage: { getItem: () => override, removeItem: () => { override = ''; } } };
    return vm.runInNewContext(functions + '\nresolveApiBase()', { window, URL, document: { querySelector: () => null }, API_BASE_STORAGE: 'app_api_base' });
}

test('Apache local apunta al puerto Node del sitio', () => {
    assert.equal(resolveFrom('http://localhost/sitio/'), `http://localhost:${local}/api`);
});

test('Apache puede usar cualquiera de los puertos reservados para el sitio', () => {
    for (const port of [minPort, maxPort]) {
        assert.equal(resolveFrom('http://localhost/sitio/', `http://localhost:${port}/api`), `http://localhost:${port}/api`);
    }
});

test('un puerto de otro sitio no se reutiliza desde un override local', () => {
    assert.equal(resolveFrom('http://localhost/sitio/', `http://localhost:${foreignPort}/api`), `http://localhost:${local}/api`);
});

test('Node dentro del rango y el dominio público usan su propio origen', () => {
    assert.equal(resolveFrom(`http://127.0.0.1:${maxPort}/`), '/api');
    assert.equal(resolveFrom('https://empresa.ejemplo.cl/'), '/api');
});

test('el dominio HTTPS descarta un puerto Node interno guardado anteriormente', () => {
    assert.equal(resolveFrom('https://empresa.ejemplo.cl/', `https://empresa.ejemplo.cl:${maxPort}/api`), '/api');
});
