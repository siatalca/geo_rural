// Manifiesto de la app instalable (assets/site/manifest.webmanifest, propio de cada sitio) y sus íconos.
// Las rutas deben ser relativas para que funcione en la raíz (Predia) y bajo un prefijo como /geo_rural/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SITE = require(path.join(ROOT, 'assets/site/site.js'));
const MANIFEST_PATH = 'assets/site/manifest.webmanifest';
const manifestText = fs.readFileSync(path.join(ROOT, MANIFEST_PATH), 'utf8');
const BASES = ['https://predia.example/', 'https://mi-registro.example/geo_rural/'];

function pngSize(file) {
    const buffer = fs.readFileSync(file);
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} no es PNG`);
    return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

function assertRelative(value, label) {
    assert.equal(typeof value, 'string', `${label} debe ser texto`);
    assert.ok(value.length > 0, `${label} vacío`);
    assert.ok(!value.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(value), `${label} debe ser relativa: ${value}`);
}

// Ruta del archivo del proyecto al que apunta una URL relativa al manifiesto, igual con o sin prefijo.
function projectPath(relative) {
    const results = BASES.map((base) => {
        const resolved = new URL(relative, new URL(MANIFEST_PATH, base));
        assert.ok(resolved.href.startsWith(base), `${relative} se sale del sitio en ${base}`);
        return resolved.href.slice(base.length);
    });
    assert.equal(new Set(results).size, 1);
    return results[0];
}

test('el manifiesto es JSON válido con el nombre y color del sitio', () => {
    const manifest = JSON.parse(manifestText);
    assert.equal(manifest.name, SITE.appName);
    assert.equal(manifest.short_name, SITE.appName);
    assert.equal(manifest.display, 'standalone');
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
    assert.equal(manifest.theme_color, SITE.themeColor);
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
});

test('start_url y scope son relativos y llevan al login dentro del sitio', () => {
    const manifest = JSON.parse(manifestText);
    assertRelative(manifest.start_url, 'start_url');
    assertRelative(manifest.scope, 'scope');
    assert.equal(projectPath(manifest.start_url), 'registro/login/registro.html');
    assert.equal(projectPath(manifest.scope), '');
    assert.ok(fs.existsSync(path.join(ROOT, 'registro/login/registro.html')));
});

test('los íconos existen con el tamaño declarado', () => {
    const manifest = JSON.parse(manifestText);
    const declared = new Set();
    for (const icon of manifest.icons) {
        assertRelative(icon.src, 'icon.src');
        assert.equal(icon.type, 'image/png');
        const file = path.join(ROOT, projectPath(icon.src));
        assert.ok(fs.existsSync(file), `falta ${icon.src}`);
        assert.equal(pngSize(file), icon.sizes, icon.src);
        declared.add(`${icon.sizes} ${icon.purpose || 'any'}`);
    }
    assert.ok(declared.has('192x192 any'), 'falta ícono 192 any');
    assert.ok(declared.has('512x512 any'), 'falta ícono 512 any');
    assert.ok(declared.has('512x512 maskable'), 'falta ícono maskable');
    assert.equal(pngSize(path.join(ROOT, 'assets/img/apple-touch-icon.png')), '180x180');
});

test('login e inicio enlazan el manifiesto y el ícono de Apple con rutas relativas', () => {
    for (const [page, prefix] of [['registro/login/registro.html', '../../'], ['index.html', '']]) {
        const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
        assert.ok(html.includes(`<link rel="manifest" href="${prefix}${MANIFEST_PATH}">`), `${page} sin manifiesto`);
        assert.ok(html.includes(`<link rel="apple-touch-icon" href="${prefix}assets/img/apple-touch-icon.png">`), `${page} sin ícono de Apple`);
    }
    const login = fs.readFileSync(path.join(ROOT, 'registro/login/registro.html'), 'utf8');
    assert.match(login, /<button type="button" id="installAppBtn" class="install-app-btn" hidden/);
    assert.ok(login.includes('src="../../assets/js/instalar-app.js'));
});
