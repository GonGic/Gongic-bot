# GonGic ⏱️

Registro de horas en voz de los colaboradores del servidor **Gon Dev's**. Cada vez que un colaborador entra a un canal de trabajo se abre una sesión, y al salir se cierra. Cada quien consulta sus horas por día, semana o mes.

## Reglas

- Se registran las horas de quien tenga el rol **SS** (servicio social), **Programador** o **PM** (empleados). Quien tenga SS y además otro rol se trata como SS.
- Solo cuentan los canales de voz que ADMIN agregue con `/canales`.
- Una sesión empieza al entrar a un canal que cuenta y termina al salir. Moverse entre canales que cuentan no la corta, y se muestra el canal donde empezó.
- No hay pausas: silenciado o ensordecido cuenta igual.
- Si una sesión cruza la medianoche, cada día suma solo su parte (hora de Ciudad de México).
- Si el bot se apaga: al encender, quien sigue en el canal continúa su sesión (cuenta todo el tiempo apagado). A quien ya se fue se le cierra la sesión a la hora en que encendió el bot.

## Servicio social (SS)

- Meta de **480 horas** (`config.metaServicioHoras`). El acumulado son todas sus horas en voz más los ajustes de ADMIN. Al pasar la meta se marca como completado y se sigue registrando.
- `/mis-horas` y `/horas-de` muestran al final su avance: `Servicio social: 125h 30m / 480h (26%) · Faltan 354h 30m`.
- Al completar, el SS recibe un mensaje privado y se avisa en `CANAL_AVISOS_ID`, una sola vez. Si un ajuste lo baja de la meta, se volverá a avisar al completarla.
- Los ajustes solo cuentan para el servicio social, no aparecen en las horas por día, semana o mes.

Programador y PM no tienen meta.

## Comandos

Todas las respuestas las ve solo quien usa el comando. La fecha es opcional, en formato `dd/mm` o `dd/mm/yyyy`. Sin fecha se usa hoy, y sin año se usa el actual.

| Comando | Quién | Qué muestra |
|---|---|---|
| `/mis-horas dia [fecha]` | Todos | Las sesiones del día con inicio, fin y tiempo activo |
| `/mis-horas semana [fecha]` | Todos | De lunes a domingo de la semana de esa fecha |
| `/mis-horas mes [fecha]` | Todos | Todos los días del mes de esa fecha, el total, los días con actividad y el promedio diario |
| `/horas-de dia\|semana\|mes usuario [fecha]` | ADMIN y PM | Lo mismo, de otro colaborador. ADMIN ve a SS, Programador y PM; PM ve a SS y Programador |
| `/servicio-social progreso` | SS | Su acumulado, lo que falta, la fecha de inicio y los ajustes |
| `/servicio-social lista` | ADMIN y PM | Avance de todos los SS |
| `/servicio-social ajustar usuario horas motivo [minutos]` | ADMIN | Suma o resta horas (con negativos) a un SS, sin bajar de 0 |
| `/canales agregar\|quitar\|lista` | ADMIN | Canales de voz donde se cuentan las horas |
| `/limpiar [canal]` | ADMIN | Borra **todos** los mensajes de un canal de texto (por defecto, el actual), incluidos los fijados. Pide confirmación con botón |

## Instalación

1. Crea una aplicación nueva en el [portal de desarrolladores de Discord](https://discord.com/developers/applications) (un bot distinto a Gon Coins). En **Bot**, activa **Server Members Intent** y copia el token.
2. Invita el bot con los scopes `bot` y `applications.commands`. Su rol debe poder ver los canales de voz y, para `/limpiar`, tener **Gestionar mensajes** y **Leer el historial de mensajes** en los canales que se vayan a limpiar.
3. Copia `.env.example` como `.env` y llena `DISCORD_TOKEN`, `GUILD_ID`, `CANAL_AVISOS_ID` y `MONGODB_URI` (puede ser el mismo cluster de Gon Coins; la base es `gongic`).
4. `npm install` y luego `npm start`.
5. En Discord, agrega los canales con `/canales agregar`.

## Producción (bot-hosting.net)

- Corre en el **paquete pagado** de bot-hosting.net, desplegado desde este repositorio. El panel lo arranca con `node index.js` en Node 24.
- Las variables (`DISCORD_TOKEN`, `GUILD_ID`, `CANAL_AVISOS_ID`, `MONGODB_URI`, `MONGODB_DB`) se cargan en el panel; en el servidor no hay `.env`.
- **Deploy automático:** `.github/workflows/deploy.yml` corre al fusionar un PR a `main` (o a mano desde Actions). Revisa la sintaxis, llama a `POST /api/v1/deployments/<ID>/sync` y espera dos lecturas seguidas en `running`.
- **Secrets de GitHub** (environment `production`): `BOT_HOSTING_API_KEY` (permisos `deployments:write` y `deployments:read`) y `BOT_HOSTING_DEPLOYMENT_ID`.
