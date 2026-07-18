# Agente de seguridad y vulnerabilidades - Geo Rural

Este documento sirve como guia de revision de seguridad para el sistema Geo Rural. Su objetivo es mantener una lista clara de riesgos, controles existentes, verificaciones recomendadas y acciones pendientes.

## Objetivo

Ayudar a revisar y documentar:

- Vulnerabilidades del sitio.
- Exposicion de puertos y servicios.
- Manejo de credenciales.
- Seguridad de sesiones.
- Permisos por rol.
- Riesgos en API y base de datos.
- Procedimientos seguros de despliegue.

## Superficie principal del sistema

- Frontend publico: `/`, `/index.html`
- Frontend interno: `/registro/login/registro.html`
- API backend: `/api/*`
- Servidor Node: puerto `3001`
- Base de datos: MySQL/MariaDB, puerto `3306`
- Repositorio: `https://github.com/siatalca/geo_rural.git`
- Archivo de entorno local: `.env`

## Datos sensibles

Revisar y proteger siempre:

- `.env`
- `DB_USER`
- `DB_PASSWORD`
- `MYSQL_ROOT_PASSWORD`
- `API_WRITE_KEY`
- `SUPERUSER_USERNAME`
- `SUPERUSER_PASSWORD`
- Credenciales SMTP
- Cookies de sesion
- Logs que puedan contener datos personales

Reglas:

- No subir `.env` a GitHub.
- No compartir claves en capturas de pantalla.
- No guardar claves reales en documentos publicos.
- Cambiar claves si alguna fue expuesta accidentalmente.
- Usar claves diferentes entre local, pruebas y produccion.

## Roles y permisos

Roles identificados:

- `SUPER`
- `ADMIN`
- `SECRETARIA`
- `OPERADOR`
- `SUPERVISOR`
- `INVITADO`

Controles esperados:

- `SUPER`: administracion completa.
- `ADMIN`: gestion administrativa limitada frente a `SUPER`.
- `SECRETARIA`: consultas, exportaciones y gestion operativa autorizada.
- `OPERADOR`: actualizacion limitada de estado de carpeta y acciones asignadas.
- `SUPERVISOR`: revision y comentarios segun reglas del sistema.
- `INVITADO`: solo lectura.

Checklist de permisos:

- Verificar que cada endpoint valide rol en backend.
- No confiar solo en ocultar botones del frontend.
- Confirmar que `OPERADOR` no pueda crear registros si no corresponde.
- Confirmar que `INVITADO` no reciba comentarios internos ni historial sensible.
- Revisar que `SUPER` no pueda ser eliminado o degradado por usuarios sin permiso.

## Endpoints sensibles para revisar

Revisar permisos y validaciones en:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/admin/usuarios`
- `POST /api/admin/usuarios`
- `PUT /api/admin/usuarios/:userId`
- `DELETE /api/admin/usuarios/:userId`
- `GET /api/registros/buscar`
- `POST /api/registros`
- `PUT /api/registros/:numIngreso`
- `DELETE /api/registros/:numIngreso`
- `GET /api/registros/buscar-rango-fechas`
- `GET /api/registros/carpeta-estados`
- `GET /api/facturas/solicitudes`
- `POST /api/facturas/solicitudes`
- `POST /api/facturas/correo/enviar`

## Puertos y servicios

Puertos esperados:

- `3001`: Node/API Geo Rural.
- `3306`: MySQL, idealmente no expuesto publicamente.
- `80`/`443`: proxy web si aplica.
- `2222`: SSH del servidor, segun uso actual.

Checklist:

```bash
ss -ltnp
```

Validar:

- Node solo debe estar expuesto segun arquitectura definida.
- MySQL no deberia aceptar conexiones desde internet.
- SSH debe usar clave segura y, si es posible, llave publica.
- Si hay Nginx/Apache delante, revisar configuracion de proxy y TLS.

## Autenticacion y sesiones

Controles esperados:

- Cookie `HttpOnly`.
- Sesiones con expiracion.
- Logout invalida sesion.
- Limite de intentos fallidos de login.
- Bloqueo temporal por fuerza bruta.
- Passwords no deben guardarse en texto plano.

Checklist:

- Probar login con credenciales invalidas repetidas.
- Confirmar que se activa limite de intentos.
- Confirmar que una sesion expirada no permite usar API.
- Confirmar que cerrar sesion impide llamadas posteriores.
- Confirmar que cookies tengan atributos adecuados en produccion.

## API_WRITE_KEY

El sistema usa `API_WRITE_KEY` para proteger escrituras en ciertos escenarios.

Revisar:

- Que no este visible en codigo fuente publico.
- Que no quede persistido innecesariamente en navegador.
- Que las rutas de escritura lo validen cuando corresponde.
- Que sea distinto entre local y produccion.
- Que se rote si fue compartido.

## Validacion de entradas

Campos importantes:

- `numIngreso`
- `rut`
- `rol`
- `correo`
- `telefono`
- `region`
- `comuna`
- `numLotes`
- `estado`
- `estadoCarpeta`
- comentarios e historial

Checklist:

- Validar largo maximo en backend.
- Validar formato de fechas `YYYY-MM-DD`.
- Evitar SQL injection usando parametros preparados.
- Escapar HTML al renderizar datos en frontend.
- No aceptar IDs o roles desde frontend sin validar permisos en backend.

## Riesgos de exportacion Excel

Riesgos:

- Exportar datos personales.
- Formula injection en Excel si un campo empieza con `=`, `+`, `-` o `@`.
- Exportar mas informacion de la permitida por rol.

Checklist:

- Revisar si los valores exportados se neutralizan antes de crear Excel.
- Confirmar que `INVITADO` no pueda exportar informacion interna.
- Confirmar que `OPERADOR` solo exporte lo permitido.
- Confirmar que `SECRETARIA` exporte solo dentro de su alcance.

## Logs

Riesgos:

- Logs con claves.
- Logs con datos personales.
- Logs muy grandes sin rotacion.

Checklist:

```bash
tail -n 80 logs/server.log
du -h logs/*
```

Buenas practicas:

- No registrar passwords.
- No registrar tokens completos.
- Rotar logs periodicamente.
- Restringir permisos de lectura de logs.

## GitHub y despliegue

Reglas:

- Revisar `git status` antes de subir.
- No subir `.env`.
- No subir archivos temporales o descargas.
- Confirmar que el remoto correcto sea `origin`.
- Hacer `npm run check` antes de push o deploy.

Comandos:

```bash
git status -sb
git log --oneline -5
npm run check
```

Despliegue:

```bash
cd ~/subida_web/geo_rural
git pull origin main
ss -ltnp | grep :3001
kill PID_DEL_NODE
nohup npm run start:prod > logs/server.log 2>&1 &
curl http://127.0.0.1:3001/api/health
```

## Checklist de auditoria rapida

1. Revisar que `.env` no este versionado.
2. Revisar permisos de endpoints sensibles.
3. Revisar limites de login.
4. Revisar exposicion de puertos.
5. Revisar logs por secretos.
6. Revisar exportaciones por datos sensibles.
7. Revisar dependencias con vulnerabilidades conocidas.
8. Revisar que MySQL no este abierto publicamente.
9. Revisar configuracion de HTTPS si hay dominio publico.
10. Revisar que el servidor use claves seguras.

## Comandos utiles de revision

### Buscar posibles secretos en archivos versionados

```bash
git grep -n "PASSWORD\\|SECRET\\|API_KEY\\|TOKEN\\|SMTP\\|DB_PASSWORD"
```

### Revisar dependencias vulnerables

```bash
npm audit
```

Nota: revisar cada hallazgo antes de actualizar dependencias en produccion.

### Revisar archivos modificados

```bash
git status -sb
git diff --stat
```

### Revisar puertos

```bash
ss -ltnp
```

## Formato para registrar vulnerabilidades

Copiar y completar:

```md
### YYYY-MM-DD - Titulo de vulnerabilidad

Severidad:
- Baja / Media / Alta / Critica

Area:
- Frontend / Backend / Base de datos / Servidor / GitHub / Dependencias

Descripcion:
- 

Impacto:
- 

Evidencia:
```text
pegar evidencia o comando
```

Causa:
- 

Mitigacion:
- 

Archivos tocados:
- 

Commit:
- 

Validacion:
- 
```

## Bitacora de seguridad

### 2026-07-18 - Creacion de agente de seguridad

Descripcion:

- Se creo este documento para ordenar revisiones de seguridad y vulnerabilidades del sistema.

Acciones recomendadas proximas:

- Revisar si las exportaciones Excel neutralizan formula injection.
- Revisar atributos de cookies en produccion.
- Ejecutar `npm audit` y clasificar hallazgos.
- Confirmar que MySQL no este expuesto fuera del servidor.
- Confirmar que `.env` no este versionado ni publicado.
