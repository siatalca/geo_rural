# Agente de sesiones y tokens - Geo Rural

Este documento revisa como se manejan sesiones, cookies, tokens y riesgos de suplantacion en Geo Rural.

## Objetivo

Evaluar y documentar:

- Como inicia sesion un usuario.
- Como se mantiene o expira una sesion.
- Si un usuario puede quedar conectado sin querer.
- Si un atacante podria suplantar una sesion.
- Que controles existen y que cambios se aplicaron.

## Estado actualizado de sesiones

Cambios aplicados:

- El backend ya no entrega el token de sesion al frontend en `POST /api/auth/login`.
- El backend ya no entrega token en `POST /api/auth/guest`.
- El frontend ya no guarda tokens en `sessionStorage`.
- El frontend ya no envia `Authorization: Bearer`.
- El backend ya no acepta `Authorization: Bearer` como fuente de sesion.
- La sesion se valida solo con cookie `HttpOnly`.
- Se eliminan tokens antiguos de `sessionStorage` y `localStorage` al cargar la app.
- Se agrego vencimiento absoluto de sesion con `absolute_expires_at`.
- La sesion puede renovarse por actividad, pero no puede superar `AUTH_SESSION_ABSOLUTE_HOURS`.

## Archivos principales

- Backend de autenticacion: `server/server.js`
- Frontend de login/sesion: `script.js`
- Vista login: `registro/login/registro.html`
- Tabla de sesiones: `sesiones`

## Variables relevantes

- `AUTH_SESSION_HOURS`: ventana renovable de sesion.
- `AUTH_SESSION_ABSOLUTE_HOURS`: maximo absoluto de duracion de sesion.
- `SESSION_CLEANUP_INTERVAL_MINUTES`: limpieza de sesiones expiradas.
- `AUTH_COOKIE_SAME_SITE`: politica `SameSite`.
- `AUTH_COOKIE_SECURE`: modo de cookie `Secure`.
- `AUTH_COOKIE_DOMAIN`: dominio de cookie si aplica.

## Modelo recomendado

### Antes

El sistema usaba cookie `HttpOnly`, pero tambien enviaba el token al navegador y el frontend lo guardaba en `sessionStorage`.

Riesgo:

- Si existia XSS, un atacante podia leer el token desde `sessionStorage`.
- Mientras el token estuviera vigente, podia enviarse como `Authorization: Bearer`.
- Como la sesion se renovaba por actividad, un usuario podia quedar conectado mucho tiempo si la pagina seguia haciendo peticiones.

### Ahora

El token queda solo en cookie `HttpOnly`.

Beneficios:

- JavaScript no puede leer el token de sesion.
- Un token antiguo guardado en navegador deja de ser util porque el backend ya no acepta `Bearer`.
- La sesion tiene limite absoluto.
- Si una pagina queda abierta, no podra renovar la sesion indefinidamente.

## Riesgo: usuario queda conectado sin querer

Causa posible:

- Sesion renovable por actividad.
- Pestaña abierta.
- Usuario no cierra sesion.

Control aplicado:

- `absolute_expires_at` en tabla `sesiones`.
- `AUTH_SESSION_ABSOLUTE_HOURS` limita la duracion maxima.
- Aunque haya actividad, `expires_at` se renueva solo hasta `absolute_expires_at`.

Recomendacion:

- En produccion usar `AUTH_SESSION_HOURS=8` o `12`.
- Usar `AUTH_SESSION_ABSOLUTE_HOURS=8` o `12` si se quiere cortar el acceso al final del dia.
- Para sesiones mas estrictas, usar `AUTH_SESSION_HOURS=2` y `AUTH_SESSION_ABSOLUTE_HOURS=8`.

## Riesgo: suplantacion de usuario

Vectores revisados:

- Robo de token desde `localStorage` o `sessionStorage`.
- Uso de `Authorization: Bearer`.
- Cookie sin `HttpOnly`.
- Cookie sin `Secure` en produccion.
- Sesiones no revocadas al cambiar clave.

Controles existentes o aplicados:

- Cookie `HttpOnly`.
- Cookie `SameSite`.
- Cookie `Secure` automatico cuando no es localhost, segun configuracion.
- Token almacenado solo como hash SHA-256 en base de datos.
- Logout marca `revoked_at`.
- Cambio de clave revoca otras sesiones.
- Edicion/eliminacion/deshabilitacion de usuarios revoca sesiones.
- Backend ya no acepta `Bearer`.
- Frontend limpia tokens antiguos.

## Tabla `sesiones`

Campos relevantes:

- `id`
- `user_id`
- `token_hash`
- `created_at`
- `last_used_at`
- `expires_at`
- `absolute_expires_at`
- `revoked_at`

Reglas:

- `expires_at`: vencimiento renovable por actividad.
- `absolute_expires_at`: corte maximo no renovable.
- `revoked_at`: cierre manual o invalidacion administrativa.

## Comandos de revision

### Ver sesiones vigentes

```sql
SELECT id, user_id, created_at, last_used_at, expires_at, absolute_expires_at, revoked_at
FROM sesiones
ORDER BY id DESC
LIMIT 20;
```

### Ver sesiones activas no expiradas

```sql
SELECT id, user_id, created_at, last_used_at, expires_at, absolute_expires_at
FROM sesiones
WHERE revoked_at IS NULL
  AND expires_at > NOW()
  AND absolute_expires_at > NOW()
ORDER BY last_used_at DESC;
```

### Verificar salud de API

```bash
curl http://127.0.0.1:3001/api/health
```

### Probar sesion sin login

```bash
curl -i http://127.0.0.1:3001/api/auth/me
```

Debe responder `401` si no hay cookie valida.

## Checklist de auditoria

1. Confirmar que el login no devuelva `token`.
2. Confirmar que el login si setee cookie `geo_rural_session`.
3. Confirmar que `script.js` no guarde token en `sessionStorage`.
4. Confirmar que las llamadas fetch usen `credentials: include`.
5. Confirmar que el backend no acepte `Authorization: Bearer`.
6. Confirmar que `absolute_expires_at` exista en la tabla `sesiones`.
7. Confirmar que sesiones expiradas se eliminan.
8. Confirmar que logout marca `revoked_at`.
9. Confirmar que cambio de clave revoca otras sesiones.
10. Confirmar que cookies en produccion tengan `Secure`.

## Validaciones recomendadas despues de desplegar

1. Iniciar sesion.
2. Abrir DevTools > Application > Session Storage.
3. Confirmar que no exista `geo_rural_auth_token`.
4. Revisar Network en `/api/auth/login`.
5. Confirmar que la respuesta no contiene `token`.
6. Confirmar que existe header `Set-Cookie` para `geo_rural_session`.
7. Ejecutar `/api/auth/me` y confirmar que funciona por cookie.
8. Cerrar sesion y confirmar que `/api/auth/me` responde `401`.

## Bitacora

### 2026-07-18 - Endurecimiento de sesiones

Sintoma/Riesgo:

- El sistema usaba cookie `HttpOnly`, pero tambien entregaba token al frontend.
- El token podia quedar en `sessionStorage`.
- La sesion renovable podia mantenerse activa indefinidamente por actividad.

Correccion:

- Se dejo de devolver token al frontend.
- Se dejo de guardar token en navegador.
- Se dejo de enviar `Authorization: Bearer`.
- Se dejo de aceptar `Bearer` en backend.
- Se agrego expiracion absoluta de sesion.
- Se agrego limpieza de tokens antiguos en el frontend.

Archivos tocados:

- `server/server.js`
- `script.js`
- `agente_sesiones.md`

Validacion:

- Ejecutar `npm.cmd run check` localmente.
- Desplegar y confirmar login/logout en produccion.
