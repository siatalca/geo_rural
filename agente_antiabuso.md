# Agente antiabuso y supervision - Geo Rural

Este documento define medidas para detectar, limitar y responder a uso malintencionado del sistema Geo Rural.

## Objetivo

Supervisar y reducir riesgos como:

- Fuerza bruta contra login.
- Robo o abuso de sesiones.
- Usuarios internos abusando de permisos.
- Exportaciones masivas de datos.
- Automatizacion de consultas.
- Intentos de modificar registros sin autorizacion.
- Uso indebido de endpoints administrativos.
- Sobrecarga intencional del servidor.

## Stack actual

- Backend: Node.js + Express.
- Base de datos: MySQL/MariaDB.
- Frontend: HTML, CSS, JavaScript.
- Sesiones: cookie `HttpOnly` + tabla `sesiones`.
- Roles: `SUPER`, `ADMIN`, `SECRETARIA`, `OPERADOR`, `SUPERVISOR`, `INVITADO`.
- Despliegue: `npm run start:prod`.
- Logs: `logs/server.log`.
- Puerto API: `3001`.

## Riesgos principales por tipo de atacante

### Atacante externo

Puede intentar:

- Probar claves de usuarios.
- Automatizar requests al login.
- Buscar endpoints expuestos.
- Forzar errores para obtener informacion.
- Usar origenes no permitidos.

Controles recomendados:

- Rate limit por IP y usuario.
- Bloqueo temporal por intentos fallidos.
- Cookies `HttpOnly`, `SameSite` y `Secure`.
- Respuestas de error sin datos internos.
- Validacion estricta de origenes CORS.
- Registro de eventos sospechosos.

### Usuario interno malintencionado

Puede intentar:

- Exportar demasiados datos.
- Modificar registros fuera de su rol.
- Usar credenciales de otra persona.
- Mantener sesiones abiertas en equipos compartidos.
- Crear o modificar usuarios indebidamente.

Controles recomendados:

- Auditoria de acciones por usuario.
- Limites de exportacion.
- Registro de IP y user-agent.
- Revocacion de sesiones desde panel `SUPER`.
- Alertas por comportamiento anormal.
- Reautenticacion para acciones criticas.

## Soluciones recomendadas para este stack

### 1. Rate limit general por IP

Implementar middleware Express para limitar requests por IP.

Recomendacion:

- Login: limite estricto.
- API general: limite moderado.
- Exportaciones: limite especial.

Ejemplo de politica:

```text
Login: 5 intentos fallidos cada 15 minutos.
API general: 300 requests cada 15 minutos por IP.
Exportaciones: 10 exportaciones cada 30 minutos por usuario.
Admin: 60 acciones cada 15 minutos por usuario.
```

El sistema ya tiene control de intentos de login. Pendiente recomendado:

- Agregar rate limit general para `/api/*`.
- Agregar rate limit especifico para exportaciones.

### 2. Auditoria de acciones sensibles

Crear tabla `auditoria_eventos`.

Campos sugeridos:

```sql
CREATE TABLE auditoria_eventos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NULL,
    username VARCHAR(80) NULL,
    role VARCHAR(20) NULL,
    ip VARCHAR(80) NULL,
    user_agent VARCHAR(255) NULL,
    accion VARCHAR(80) NOT NULL,
    recurso VARCHAR(120) NULL,
    detalle JSON NULL,
    nivel VARCHAR(20) NOT NULL DEFAULT 'INFO',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_auditoria_user (user_id),
    KEY idx_auditoria_accion (accion),
    KEY idx_auditoria_created (created_at)
);
```

Eventos que conviene registrar:

- Login exitoso.
- Login fallido.
- Logout.
- Sesion expirada.
- Cambio de clave.
- Creacion/edicion/eliminacion de usuario.
- Reset de clave.
- Exportacion Excel.
- Busqueda por rango amplio.
- Eliminacion de registro.
- Cambio de estado de carpeta.
- Envio de correo.
- Error 403 por permiso insuficiente.
- Error 401 por sesion invalida.

### 3. Alertas para actividad sospechosa

Reglas simples:

- Mas de 5 fallos de login por usuario.
- Mas de 20 busquedas en 5 minutos.
- Exportaciones repetidas por el mismo usuario.
- Uso fuera de horario.
- Acceso desde IP desconocida.
- Muchos errores `401` o `403`.
- Operador intentando endpoints no permitidos.

Respuesta recomendada:

- Registrar evento `WARN` o `HIGH`.
- Mostrar en panel `SUPER`.
- Opcional: enviar correo al administrador.

### 4. Limites para exportaciones

Riesgo:

- Las exportaciones contienen datos personales.
- Un usuario con acceso podria descargar volumen excesivo.

Soluciones:

- Limitar cantidad maxima por exportacion.
- Registrar cada exportacion.
- Pedir filtros obligatorios para exportaciones grandes.
- Agregar marca en auditoria con cantidad exportada.
- Bloquear exportaciones repetidas en corto periodo.

Politica sugerida:

```text
OPERADOR: maximo 500 carpetas por exportacion.
SECRETARIA: maximo 300 registros por exportacion.
SUPER: sin limite operativo, pero auditado.
```

Actualmente ya existen `LIMIT 500` y `LIMIT 300` en consultas relevantes. Pendiente:

- Auditar cada exportacion.
- Limitar frecuencia por usuario.

### 5. Reautenticacion para acciones criticas

Acciones criticas:

- Crear usuario.
- Cambiar rol.
- Resetear clave.
- Eliminar usuario.
- Eliminar registro.
- Cambiar correo SMTP.
- Desactivar cuenta invitado.

Solucion:

- Pedir clave actual antes de ejecutar accion critica.
- Backend valida clave contra `usuarios.password_hash`.

Esto evita que alguien con una sesion abierta en un computador compartido haga cambios graves sin saber la clave.

### 6. Sesiones seguras

El sistema ya fue ajustado para:

- Usar cookie `HttpOnly`.
- No exponer token al frontend.
- No aceptar `Authorization: Bearer`.
- Tener expiracion absoluta con `AUTH_SESSION_ABSOLUTE_HOURS`.

Soluciones adicionales:

- Mostrar sesiones activas por usuario.
- Permitir a `SUPER` revocar sesiones.
- Registrar IP y user-agent en la tabla `sesiones`.
- Alertar si una misma cuenta cambia de IP rapidamente.

Campos sugeridos en `sesiones`:

```sql
ALTER TABLE sesiones ADD COLUMN ip VARCHAR(80) NULL;
ALTER TABLE sesiones ADD COLUMN user_agent VARCHAR(255) NULL;
```

### 7. Proteccion contra CSRF

Como la sesion vive en cookie, existe riesgo CSRF si un sitio externo logra enviar requests.

Controles actuales:

- `SameSite=Lax`.
- CORS con origenes permitidos.
- `X-API-Key` para escrituras.

Mejora recomendada:

- Agregar token CSRF por sesion para requests `POST`, `PUT`, `DELETE`.
- Enviar CSRF token al frontend desde `/api/auth/me`.
- Guardarlo solo en memoria JS.
- Validarlo en header `X-CSRF-Token`.

Prioridad:

- Media si el sitio solo se usa internamente.
- Alta si esta publicado en internet.

### 8. Seguridad de contrasenas

Controles actuales:

- Hash PBKDF2 SHA-512.
- Salt por usuario.
- Largo maximo.
- Cambio obligatorio con claves temporales.

Mejoras recomendadas:

- Minimo 10 caracteres para usuarios administrativos.
- Bloquear claves comunes.
- Historial de ultimas claves.
- Reautenticacion para cambios sensibles.
- Rotacion de claves temporales.

### 9. Logs seguros

No registrar:

- Passwords.
- Tokens.
- API keys.
- Claves SMTP.

Registrar:

- Usuario.
- Rol.
- IP.
- Accion.
- Resultado.
- Cantidad exportada.
- Endpoint.
- Codigo HTTP.

Comandos:

```bash
tail -n 100 logs/server.log
grep -i "Sesion rechazada\\|403\\|401\\|export" logs/server.log
```

### 10. Dependencias y actualizaciones

Comandos:

```bash
npm audit
npm outdated
```

Regla:

- No actualizar en produccion sin probar localmente.
- Si hay vulnerabilidad critica, crear rama/cambio, probar `npm run check` y desplegar.

## Plan de implementacion recomendado

### Etapa 1 - Rapida y de bajo riesgo

- Registrar exportaciones en log o tabla.
- Agregar IP y user-agent a sesiones.
- Agregar limites de exportacion por usuario.
- Mostrar al `SUPER` sesiones activas sospechosas.

### Etapa 2 - Control real antiabuso

- Crear tabla `auditoria_eventos`.
- Middleware `auditEvent()`.
- Middleware de rate limit por IP/usuario.
- Registrar errores `401`, `403`, login fallido y exportaciones.

### Etapa 3 - Proteccion avanzada

- CSRF token para escrituras.
- Reautenticacion para acciones criticas.
- Alertas por correo para actividad sospechosa.
- Panel `SUPER` con eventos recientes.

## Checklist diario/semanal

### Diario

```bash
curl http://127.0.0.1:3001/api/health
tail -n 80 logs/server.log
ss -ltnp | grep :3001
```

### Semanal

```bash
git status -sb
npm run check
npm audit
```

Revisar:

- Login fallidos.
- Exportaciones masivas.
- Usuarios nuevos.
- Cambios de rol.
- Sesiones activas antiguas.

## Plantilla de incidente de abuso

```md
### YYYY-MM-DD - Incidente

Tipo:
- Login / Exportacion / Permisos / Sesion / API / Otro

Usuario:
-

IP:
-

Sintoma:
-

Evidencia:
```text
pegar log o datos
```

Impacto:
-

Accion inmediata:
-

Correccion definitiva:
-

Commit:
-

Validacion:
-
```

## Bitacora

### 2026-07-18 - Creacion de agente antiabuso

Se creo este documento para definir medidas antiabuso segun el stack actual de Geo Rural.

Prioridades sugeridas:

1. Auditoria de exportaciones.
2. Rate limit general por IP/usuario.
3. Registro de IP y user-agent en sesiones.
4. Reautenticacion para acciones criticas.
5. CSRF token para escrituras.
