# Agente de analisis de errores - Geo Rural

Este documento sirve como guia para diagnosticar errores del sistema Geo Rural y dejar registro de problemas encontrados, causas y soluciones.

## Objetivo

Mantener una bitacora tecnica de errores para que cualquier revision futura tenga contexto rapido sobre:

- Que fallo.
- Donde revisar.
- Como reproducir o confirmar el problema.
- Que causa se encontro.
- Que cambio o comando lo resolvio.

## Componentes principales

- Frontend principal: `index.html`, `script.js`, `styles.css`
- Vista interna/login: `registro/login/registro.html`
- Backend/API: `server/server.js`
- Base de datos: MySQL/MariaDB
- Puerto backend: `3001`
- Endpoint de salud: `GET /api/health`
- Logs en servidor: `logs/server.log`

## Comandos rapidos de diagnostico

### Verificar que Node responde

```bash
curl http://127.0.0.1:3001/api/health
```

Respuesta esperada:

```json
{"ok":true}
```

### Ver proceso usando el puerto 3001

```bash
ss -ltnp | grep :3001
```

Ejemplo esperado:

```text
LISTEN 0 511 0.0.0.0:3001 0.0.0.0:* users:(("node",pid=18061,fd=18))
```

### Revisar logs del servidor

```bash
tail -n 80 logs/server.log
```

### Verificar sintaxis antes de reiniciar

```bash
npm run check
```

En Windows local:

```powershell
npm.cmd run check
```

### Reiniciar Node en servidor

```bash
ss -ltnp | grep :3001
kill PID_DEL_NODE
nohup npm run start:prod > logs/server.log 2>&1 &
curl http://127.0.0.1:3001/api/health
```

## Errores comunes detectados

### Node no inicia por MySQL apagado

Sintoma:

```text
connect ECONNREFUSED 127.0.0.1:3306
```

Causa probable:

- MySQL no esta corriendo.
- Docker Desktop no esta iniciado en ambiente local.
- El puerto `3306` no esta disponible.

Revision:

```bash
ss -ltnp | grep :3306
```

Local con Docker:

```powershell
docker compose ps
docker compose up -d
```

### Puerto 3001 ocupado

Sintoma:

```text
listen EADDRINUSE: address already in use 0.0.0.0:3001
```

Causa probable:

- Ya existe un proceso Node corriendo.
- Se intento levantar otra instancia encima.

Revision:

```bash
ss -ltnp | grep :3001
```

Solucion:

```bash
kill PID_DEL_NODE
nohup npm run start:prod > logs/server.log 2>&1 &
```

### API responde 404 al buscar registro

Ejemplo:

```text
GET /api/registros/buscar?numIngreso=10-2026 404
```

Causa probable:

- El registro no existe en base de datos.
- El `NRO INGRESO` consultado todavia no fue guardado.

Confirmacion:

- Buscar otro dato del cliente.
- Revisar si el numero corresponde a una sugerencia para nuevo registro.

### Exportacion operador no muestra carpetas sin estado

Sintoma:

- Al seleccionar `TODOS`, solo aparecen carpetas con `ESTADO CARPETA`.

Causa encontrada:

- El endpoint `/api/registros/carpeta-estados` filtraba siempre con:

```sql
estado_carpeta IS NOT NULL AND TRIM(estado_carpeta) <> ''
```

Solucion aplicada:

- El filtro por `estado_carpeta` solo se aplica cuando se seleccionan estados especificos.
- Con `TODOS`, se respetan solo filtros adicionales como region y fecha.

Commit relacionado:

```text
9a87e32 Incluye carpetas sin estado en exportacion
```

## Checklist para analizar un error nuevo

1. Identificar si falla frontend, API, base de datos o despliegue.
2. Revisar consola del navegador si es un error visual o de boton.
3. Revisar `logs/server.log` si es error de API.
4. Probar `curl http://127.0.0.1:3001/api/health`.
5. Revisar si el puerto `3001` esta ocupado.
6. Ejecutar `npm run check`.
7. Confirmar si hubo cambios recientes con `git log --oneline -5`.
8. Si el error ocurre solo en servidor, comparar commit local vs servidor.
9. Documentar el resultado en la bitacora de este archivo.

## Formato para registrar errores

Copiar y completar este bloque:

```md
### YYYY-MM-DD - Titulo corto del error

Sintoma:
- 

Contexto:
- Usuario/rol:
- Pantalla:
- Accion realizada:

Evidencia:
```text
pegar error o log relevante
```

Causa:
- 

Solucion:
- 

Archivos tocados:
- 

Commit:
- 

Validacion:
- 
```

## Bitacora de errores

### 2026-07-18 - Reinicio de Node despues de pull

Sintoma:

- Despues de hacer `git pull`, habia que reiniciar Node para tomar cambios.
- Al lanzar `nohup npm run start:prod`, el log mostro `EADDRINUSE`.

Evidencia:

```text
No fue posible iniciar el servidor: listen EADDRINUSE: address already in use 0.0.0.0:3001
```

Causa:

- Ya existia un proceso `node` escuchando en `3001`.
- El intento adicional de iniciar Node fallo, pero el proceso real seguia activo.

Solucion:

- Confirmar proceso con:

```bash
ss -ltnp | grep :3001
```

- Confirmar salud con:

```bash
curl http://127.0.0.1:3001/api/health
```

Validacion:

```json
{"ok":true}
```

### 2026-07-18 - Exportacion operador no incluia carpetas sin estado

Sintoma:

- Al seleccionar `TODOS` en filtros de carpetas SAG, no aparecian carpetas sin estado.

Causa:

- El backend aplicaba siempre filtro para excluir `estado_carpeta` vacio.

Solucion:

- Se ajusto `server/server.js` para que `TODOS` no filtre por estado.
- Los filtros de fecha y region siguen aplicando normalmente.

Commit:

```text
9a87e32 Incluye carpetas sin estado en exportacion
```
