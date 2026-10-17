// Copia el código común de esta instalación a otra (Predia <-> Geo Rural).
// Uso: node tools/sincronizar-comun.js <carpeta_destino> [--aplicar]
// Sin --aplicar solo muestra qué archivos cambiarían. Nunca toca .env, bases de datos
// ni los archivos propios de cada sitio (assets/site/, logos, PDF de cotización, README, deploy).
const fs = require('node:fs');
const path = require('node:path');

const COMMON_FILES = [
    'server/server.js',
    'server/bootstrap.js',
    'script.js',
    'styles.css',
    'index.html',
    'pages/seguimiento.html',
    'pages/mantenimiento.html',
    'registro/index.html',
    'registro/login/registro.html',
    'assets/js/chatbot.js',
    'assets/js/role-guide.js',
    'assets/js/site-brand.js',
    'assets/js/pages/seguimiento.js',
    'assets/js/pages/mantenimiento.js',
    'assets/css/brand.css',
    'assets/css/pages/seguimiento.css',
    'assets/css/pages/mantenimiento.css',
    'tests/api-origin.test.js',
    'tests/bootstrap.test.js',
    'tests/server.test.js',
    'tools/sincronizar-comun.js',
    'docs/CODIGO_COMUN.md'
];

const source = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || '');
const apply = process.argv.includes('--aplicar');

if (!process.argv[2] || !fs.existsSync(path.join(target, 'assets', 'site', 'site.js'))) {
    console.error('Indica la carpeta de la otra instalación (debe tener assets/site/site.js).');
    process.exit(1);
}
if (target === source) {
    console.error('El destino es esta misma carpeta.');
    process.exit(1);
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null);
let changed = 0;
for (const relative of COMMON_FILES) {
    const from = path.join(source, relative);
    const to = path.join(target, relative);
    const content = read(from);
    if (content === null || content === read(to)) continue;
    changed += 1;
    console.log(`${apply ? 'copiado ' : 'cambiaría'}  ${relative}`);
    if (apply) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, content);
    }
}
console.log(changed ? `${changed} archivo(s) ${apply ? 'copiados' : 'por copiar (agrega --aplicar)'}.` : 'Código común ya igual.');
