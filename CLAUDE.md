# GonGic — Bot de registro de horas para Discord

Bot del servidor **Gon Dev's** (el mismo de Gon Coins) del profesor Gon161. Registra las horas en voz de los colaboradores.

## Cómo trabajar en este proyecto
- Responder siempre en **español**.
- **Preguntar antes de programar**: proponer el diseño, esperar aprobación y luego implementar.
- Implementar solo lo que se pide, sin agregar funciones extra.

## Stack
- Node.js 20+ (CommonJS), sin TypeScript. `discord.js` v14 (comandos por servidor) y `mongodb` v7 sobre MongoDB Atlas (base `gongic`).
- Arranque en local: `npm start` → `node --env-file=.env index.js`. En el hosting: `node index.js` con Node 24. Variables: `DISCORD_TOKEN`, `GUILD_ID`, `CANAL_AVISOS_ID` (aviso a ADMIN cuando un SS completa), `MONGODB_URI`, `MONGODB_DB` (default `gongic`).
- Intents: Guilds, GuildMembers (**Server Members Intent** en el portal) y GuildVoiceStates.
- DNS: `db.conectar()` siempre usa `1.1.1.1` y `8.8.8.8` para resolver el SRV de Atlas.

## Estructura
| Archivo | Responsabilidad |
|---|---|
| `index.js` | Cliente, evento de voz (cola en orden por usuario), sincronización al encender, aviso de meta del SS y comandos |
| `comandos.js` | `/mis-horas`, `/servicio-social`, `/horas-de`, `/canales` y `/limpiar` |
| `db.js` | Conexión, sesiones, totales y ajustes del servicio social, y canales |
| `horas.js` | Fechas de CDMX (`-06:00` fijo), lectura de `dd/mm[/yyyy]`, recorte por día y textos (incluido el servicio social) |
| `roles.js` | Detección de roles normalizando nombres (sin emojis, espacios, acentos ni mayúsculas) |
| `config.js` | Roles, permisos de consulta, meta del servicio social y zona horaria |

## Reglas de negocio (aprobadas)
- **Colaboradores:** `SS` (servicio social) y empleados `Programador` y `PM`. Quien tenga SS y otro rol se trata como SS. Solo cuentan los canales agregados con `/canales` (solo ADMIN, guardados en Mongo).
- **Sesión:** abre al entrar a un canal que cuenta y cierra al salir. Moverse entre canales que cuentan no la corta (se muestra el canal inicial). Sin pausas: silenciado o ensordecido cuenta.
- **Medianoche:** la sesión se parte; cada día suma su parte. El tramo cortado muestra `00:00` de inicio o `23:59` de fin.
- **Bot apagado:** al encender, quien sigue en voz continúa su sesión (se cuenta el hueco). Quien ya no está se cierra a la hora de encendido. Quien está sin sesión abierta recibe una desde ese momento.
- **`/mis-horas dia|semana|mes [fecha]`** (efímero, en **embed**): color por rol de la persona consultada (SS verde, Programador azul, PM morado). Título con emoji (🕒 día, 📆 semana, 🗓️ mes). Pie común `GonGic · Zona horaria MX` (`horas.PIE`). Si es SS, se agrega el campo 🎓 Servicio social con barra de 10 bloques (▰▱), porcentaje, acumulado y lo que falta. `horas.js` devuelve `{ titulo, descripcion, campos, pie }` e `index.js` arma el embed.
  - `dia`: sesiones con inicio, fin ("en curso" si sigue abierta) y tiempo activo; total, sesiones y zona horaria. Sin datos: "No hay registro para ese día".
  - `semana`: lunes a domingo de la semana de la fecha; días vacíos "Sin actividad"; total semanal.
  - `mes`: todos los días del mes de la fecha (vacíos "Sin actividad"); total, días con actividad y promedio entre los días con actividad.
  - Fecha `dd/mm` o `dd/mm/yyyy`; sin fecha hoy, sin año el actual.
- **`/horas-de`:** igual que `/mis-horas`, sobre otro colaborador. ADMIN ve a SS, Programador y PM; PM ve a SS y Programador (`config.consultas`).
- **Servicio social (SS):**
  - Meta de 480 h (`config.metaServicioHoras`). Acumulado = todas las sesiones (las abiertas hasta ahora) + ajustes, nunca negativo. Al pasarla se marca completado y se sigue registrando.
  - `/mis-horas` y `/horas-de` agregan al final `Servicio social: X / 480h (N%) · Faltan Y` si la persona es SS.
  - `/servicio-social progreso` (SS): acumulado, faltante, primera sesión, fecha de completado y ajustes.
  - `/servicio-social lista` (ADMIN y PM): todos los SS en **orden alfabético** (no es una competencia: sin medallas ni lugares), cada uno con su barra, porcentaje, acumulado y lo que falta; campos de completados y en servicio.
  - `/servicio-social ajustar usuario horas motivo [minutos]` (solo ADMIN): con negativos para restar; se rechaza si deja el total bajo 0. Los ajustes **solo** cuentan para el servicio, no en día/semana/mes.
  - Aviso al completar (DM al SS y mensaje en `CANAL_AVISOS_ID`), una sola vez gracias a `servicio_social`. Se revisa al cerrar sesión, al ajustar y cada minuto para sesiones abiertas. Si un ajuste lo baja de la meta, se borra la marca y se volverá a avisar.
- Programador y PM: sin meta.
- **`/limpiar [canal]`** (solo ADMIN): borra todos los mensajes de un canal de texto, anuncios o chat de voz (por defecto el actual), incluidos los fijados. Pide confirmación con botón (expira en 2 min). Borra en bloque los de menos de 14 días y uno por uno los más viejos; el canal no se recrea (mismo ID). Muestra avance cada 10 s, y si el mensaje privado ya expiró (15 min) avisa por DM. Si una vuelta no logra borrar nada, se detiene. Requiere que el bot tenga Ver canal, Leer el historial y Gestionar mensajes en ese canal.
- Duraciones: `53m`, `8h 5m`, `11h` (minutos truncados, sumando milisegundos).
- **Todas las respuestas y avisos son embeds** (`armarEmbed` en `index.js` a partir de `{ titulo?, descripcion, campos?, pie? }` de `horas.js`; si no hay `pie`, usa `horas.PIE`). Estilo (rama `rediseno`): títulos con emoji, datos clave en **campos** lado a lado (totales, sesiones, días con actividad, promedio, acumulado, faltan, inicio) y barras ▰▱ (`horas.barra`).
  - Día: cada sesión `🎙️ Sesión N · canal` y `🟢 inicio → 🔴 fin (o ⏳ en curso) ⏱️ tiempo`.
  - Semana: una línea por día con barra relativa al día con más horas; vacíos `Sin actividad`.
  - Mes: dos columnas (1-15 y 16-fin) con el tiempo de cada día; vacíos `Sin actividad`.
  - Colores: por rol en horas y progreso, verde SS en lista/ajuste/avisos, azul en `/canales` y `/limpiar`, rojo en errores (`⚠️ …`). Los ajustes en `/servicio-social progreso` muestran los últimos 10 (un campo admite 1,024 caracteres).

## Colecciones
| Colección | Contenido |
|---|---|
| `sesiones` | `userId`, `canalId`, `canalNombre` (canal inicial), `inicio`, `fin` (null si abierta), `abierta: true` mientras sigue. Índice único parcial: una abierta por usuario |
| `canales` | `_id` = ID del canal de voz, `nombre`, `agregadoPor`, `agregadoEn` |
| `ajustes_servicio` | `userId`, `minutos` (con signo), `motivo`, `adminId`, `fecha` |
| `servicio_social` | `_id` = userId, `completadoEn`. Evita repetir el aviso de meta |

## Pruebas
- Se probaron con un script la lectura de fechas, el lunes de la semana, el corte de medianoche, los textos de día, semana, mes y servicio social, y los permisos de `/horas-de`. No se probó contra Discord ni Atlas.

## Hosting y despliegue
- **Hosting:** paquete pagado de **bot-hosting.net** (2 bots), desplegado desde el repositorio de GitHub. No tiene SSH. Las variables de entorno se cargan en el panel; el `.env` solo se usa en local y nunca se sube.
- **Despliegue automático:** `.github/workflows/deploy.yml` (el mismo de Gon Coins) se ejecuta al fusionar un PR a `main`, o a mano desde Actions.
  - `check`: `npm ci --omit=dev` y revisión de sintaxis de los `.js` con Node 24.
  - `deploy`: `POST https://bot-hosting.net/api/v1/deployments/<ID>/sync` y luego lee `/logs` hasta dos lecturas seguidas en `running` (máximo 10). El sync no enciende un bot apagado.
- **Secrets de GitHub** (environment `production`): `BOT_HOSTING_API_KEY` (`deployments:write` y `deployments:read`) y `BOT_HOSTING_DEPLOYMENT_ID`.
