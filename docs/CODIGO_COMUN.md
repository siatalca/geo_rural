# Código común Predia / Geo Rural

Predia y Geo Rural usan **el mismo código**. Cada repositorio conserva su propia base de datos,
su `.env` y su GitHub; solo cambian los archivos de identidad del sitio.

## Archivos propios de cada sitio (no se copian)

| Archivo | Contenido |
|---|---|
| `.env` | Secretos e infraestructura: base, usuario, puerto, SMTP de respaldo. |
| `assets/site/site.js` | Nombre, firma y correo de respuesta (replyTo) de la cotización, prefijo de sesión/almacenamiento, ruta pública, puertos esperados y nombre de base permitido. |
| `assets/site/site.css` | Colores del logo (variables `--brand-*` definidas en `assets/css/brand.css`) y ajustes visuales de la marca. |
| `assets/img/logo.svg`, `favicon.svg`, `logo.png` | Logos (pantallas y correo). |
| PDF de cotización (`cotizacionPdf` en `site.js`) | Plantilla de la carta. |
| `README.md`, `package.json` (nombre), `.env.example`, `.htaccess`, `database/schema.sql`, `deploy/`, `server/iniciar_servidor_node.bat` | Documentación y arranque de cada instalación. |

El servidor se niega a arrancar si `DB_NAME` no corresponde al patrón de `site.js`, así un sitio no puede
conectarse por error a la base del otro.

## Pasar un cambio de un sitio al otro

```
node tools/sincronizar-comun.js ../geo_rural_unificado
node tools/sincronizar-comun.js ../geo_rural_unificado --aplicar
npm test
```

El primer comando solo muestra qué cambiaría. Después de aplicar, ejecutar `npm test` en el destino.
