# Notia — Diseño

**Fecha:** 2026-08-10
**Estado:** aprobado, listo para plan de implementación
**Usuario:** único (Mati). No es multiusuario y no se diseña para serlo.

---

## 1. Problema

Estudiante de ingeniería + trabajo. Las cosas se pierden en tres momentos distintos:

1. **Al capturar** — aparece un link, un pendiente o una fecha y no hay dónde tirarlo rápido. Termina en WhatsApp propio, pestañas abiertas o notas sueltas.
2. **Al recuperar** — está anotado en algún lado pero no se encuentra.
3. **Al recordar** — está anotado y se puede encontrar, pero nadie avisa a tiempo.

Priorizar **no** es un problema. El sistema no necesita scoring, matrices de urgencia ni metodologías de productividad.

El material accionable no nace solo de decisiones propias: buena parte aparece en conversaciones de WhatsApp (grupos de materias, canales de trabajo). Por eso el sistema no es un capturador manual sino un **agente que observa chats seleccionados** y mantiene los items sincronizados con lo que se dice ahí.

---

## 2. Alcance

### v1

- Bot de WhatsApp vía Evolution API self-hosted (captura + recordatorios).
- Selección de qué chats/grupos se observan.
- Agente LLM con sesión persistente por chat que crea, edita y cierra items de forma autónoma.
- Log de cambios reversible.
- Web app instalable (PWA) para ver, buscar, editar y cerrar items, y para administrar chats trackeados.
- Scheduler de recordatorios.

### Fuera de v1

- CLI (`notia add "…"`).
- Extensión de navegador para guardar la pestaña actual.
- Web Push nativo (los avisos de v1 van por WhatsApp).
- Multiusuario.
- Instrucción por chat en lenguaje natural (ver §11).

---

## 3. Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Modelo de datos | Un `Item` flexible, no entidades separadas | El tipo emerge de qué campos están cargados. Cero fricción al capturar, una sola query de búsqueda. |
| Parseo | LLM con herramientas, no sintaxis | No hay sintaxis que recordar justo cuando se está apurado, que es cuando peor funciona. |
| Canal | WhatsApp vía Evolution API self-hosted | Es donde el usuario ya vive. Riesgo de ban del número asumido explícitamente: Evolution es una lib no oficial. |
| Hosting | VPS propio + Docker Compose | Control total, ~5 USD/mes, sin límites de plan gratuito. |
| Stack | TypeScript: Hono + React/Vite | Un lenguaje, dominio compartido entre api y worker, arranque instantáneo. |
| Proveedor LLM | OpenAI `gpt-5.6-luna` | $0.20/$1.20 por millón de tokens tras el recorte del 2026-07-30. ~$11/mes estimados con 4 chats. |
| Autonomía del agente | Autónomo, con log reversible | Confirmar cada acción reintroduce el trabajo manual que el sistema debe eliminar. |
| Disparador | Ventana de silencio de 3 min (tope 15) | Una ráfaga = una llamada, y el agente ve la conversación completa. |
| Config por chat | Solo on/off | YAGNI. Agregar ajuste fino después es una columna nullable y un textarea. |
| Estado de sesión | Conversations API de OpenAI | ID durable sin TTL. Los `response` expiran a los 30 días; las conversaciones no. |
| Compactación | Server-side (`compact_threshold`) | Es una feature de la API, no código nuestro. |
| Ingesta | Buffer en tabla `inbox` | Decide qué entra al historial permanente, y hace el turno atómico y reintentable. |

---

## 4. Arquitectura

Cinco contenedores en `docker-compose.yml`, con Caddy adelante para TLS automático.

```
                          TODOS los chats de WhatsApp
                                    │
                        ┌───────────▼────────────────────────┐
                        │ evolution-api   (sesión QR, volumen)│
                        └───────────┬────────────────────────┘
                                    │ POST /webhook/whatsapp
                        ┌───────────▼────────────────────────┐
   Navegador ──────────▶│ notia-api        Hono               │
   (PWA)                │   /webhook/whatsapp                 │
                        │   /api/items  /api/chats  /u/:token │
                        └───────────┬────────────────────────┘
                                    │
                        ┌───────────▼────────────────────────┐
                        │ postgres                            │
                        └───────────▲────────────────────────┘
                                    │
   ┌────────────────────────────────┴────────────────────────┐
   │ notia-worker     dos jobs independientes, cada 30 s      │
   │                                                          │
   │   A) despachador de agente                               │
   │      chats con 3 min de silencio (o 15 de tope)          │
   │        → arma la tanda → responses.create → aplica       │
   │                                                          │
   │   B) scheduler de recordatorios                          │
   │      vencimientos + digest matinal + avisos de cambios   │
   └────────────────────────────────┬────────────────────────┘
                                    │
                                    └──▶ Evolution ──▶ chat propio
```

### Contenedores

| Servicio | Imagen / build | Notas |
|---|---|---|
| `caddy` | oficial | TLS automático, reverse proxy |
| `postgres` | oficial 16 | volumen persistente |
| `evolution-api` | oficial | **volumen persistente obligatorio** — sin él se pierde la sesión de WhatsApp y hay que re-escanear el QR |
| `notia-api` | monorepo | webhook + REST + sirve la PWA buildeada |
| `notia-worker` | monorepo | mismo build, entrypoint distinto |

### Monorepo

```
packages/
  core/          ← no sabe de HTTP ni de WhatsApp
    items/       CRUD y búsqueda. Única puerta a la DB.
    agent/       armado del turno, herramientas, aplicación de tool calls
    notifier/    interfaz send(canal, mensaje) + impl WhatsApp
    schema/      Drizzle
  api/           Hono. Importa core.
  worker/        node-cron. Importa core.
  web/           React + Vite + PWA
```

`core` se testea sin levantar servidor ni tocar la red. `notifier` es una interfaz precisamente para que agregar Web Push en v2 sea registrar otra implementación, sin tocar el worker.

**Los dos jobs del worker no comparten estado.** Si el despachador se cuelga en una llamada a OpenAI, los recordatorios siguen saliendo. Comparten `notifier` y nada más.

**El webhook nunca llama al LLM.** Responde 200 en milisegundos. Evolution reintenta si hay demora, y un pico de mensajes no debe encolar llamadas al modelo.

---

## 5. Modelo de datos

Cuatro tablas. No hay archivo de conversaciones de WhatsApp: el historial vive en la conversación de OpenAI, y lo que persiste localmente son los items y por qué cambiaron.

```sql
chats
  jid              text PRIMARY KEY      -- 5491122…@s.whatsapp.net | …@g.us
  nombre           text                  -- solo para la lista en la UI
  es_grupo         boolean
  tracked          boolean DEFAULT false
  conversation_id  text                  -- conv_… de OpenAI, nullable hasta el 1er uso
  pending_since    timestamptz           -- nullable; marca tanda sin procesar
  last_message_at  timestamptz
  last_seen_at     timestamptz           -- para ordenar la lista de selección
  agent_attempts   int DEFAULT 0         -- reintentos del turno actual; se resetea al éxito

inbox                                    -- cola efímera, se vacía cada turno
  id               bigserial PRIMARY KEY
  jid              text REFERENCES chats
  wa_message_id    text UNIQUE           -- dedup de reintentos de Evolution
  autor            text
  body             text
  sent_at          timestamptz
  claimed_at       timestamptz           -- nullable

items
  id               bigserial PRIMARY KEY
  content          text NOT NULL
  url              text
  due_at           timestamptz
  done_at          timestamptz
  context          text                  -- facultad | trabajo | personal
  tags             text[] DEFAULT '{}'
  source           text NOT NULL         -- whatsapp | web
  source_jid       text REFERENCES chats -- nullable; null = creado desde la web
  notified_at      timestamptz
  created_at       timestamptz DEFAULT now()
  updated_at       timestamptz DEFAULT now()

item_changes                             -- el log
  id               bigserial PRIMARY KEY
  item_id          bigint REFERENCES items
  accion           text NOT NULL         -- crear | editar | cerrar | reabrir
  antes            jsonb                 -- null en crear
  despues          jsonb
  jid              text                  -- chat que lo originó; null si fue la web
  motivo           text                  -- lo que el agente declaró
  response_id      text                  -- trazabilidad al turno de OpenAI
  undone_at        timestamptz
  notified_at      timestamptz
  created_at       timestamptz DEFAULT now()
```

### Índices

- `items (done_at, due_at)` — el scheduler barre vencimientos abiertos.
- `items (source_jid) WHERE done_at IS NULL` — snapshot de items abiertos por chat, en cada turno.
- `inbox (jid, sent_at)` — armado de la tanda.
- `item_changes (notified_at) WHERE notified_at IS NULL` — digest de cambios.
- Índice GIN de full-text sobre `content` para la búsqueda de la web.

### Reglas

- Las fechas se guardan en `timestamptz`. La zona horaria del usuario (`America/Argentina/Buenos_Aires`, configurable por env) se pasa al agente en las instructions de cada turno; sin eso "el viernes" no resuelve.
- Un item con `due_at` es un recordatorio, con `url` es material, sin nada más es una nota. El tipo es emergente, no un campo.

---

## 6. El agente

### Sesión

`session_id = chat`, 1:1, sin cruce entre chats. Se implementa con la Conversations API de OpenAI: una conversación por chat trackeado, creada con `metadata: { wa_jid }`, y su `conv_…` guardado en `chats.conversation_id`.

Se eligió Conversations sobre encadenar `previous_response_id` porque los objetos `response` se guardan 30 días y expiran; los items adjuntos a una conversación **no tienen ese TTL**. Encadenando respuestas, un chat inactivo un mes perdía su sesión.

### Forma de un turno

```ts
responses.create({
  model: "gpt-5.6-luna",
  conversation: chat.conversation_id,
  instructions: REGLAS + `zona horaria: ${TZ}` + `ahora: ${now}` + snapshotItemsAbiertos,
  input: tandaFormateada,          // "[Juan 14:02] che chicos\n[Ana 14:03] el TP3 se corre…"
  tools: [crear_item, editar_item, cerrar_item, buscar_items],
  context_management: { compact_threshold: 40_000 },
})
```

Con `conversation`, las `instructions` del turno anterior **no se arrastran** — se reescriben enteras en cada llamada. Eso hace que el snapshot de items abiertos se refresque solo y que las reglas del agente se re-anclen en cada turno (ver §9).

`compact_threshold` en 40K es holgado a propósito: con Luna el contexto es barato, así que conviene darle memoria larga al agente en vez de comprimir para ahorrar. Queda además por debajo del medidor de contexto largo de OpenAI, que subiría Luna a $0.40/$1.80.

### Herramientas

Todas las mutaciones llevan `motivo` obligatorio.

| Herramienta | Parámetros | Alcance |
|---|---|---|
| `crear_item` | `content, motivo, url?, due_at?, context?, tags?` | libre |
| `editar_item` | `id, motivo, {content?, url?, due_at?, context?, tags?}` | solo items con `source_jid` = este chat |
| `cerrar_item` | `id, motivo` | ídem |
| `buscar_items` | `query` | ídem |

**No existe `borrar_item`.** Cerrar es reversible; borrar no. Es el límite duro sobre lo que un mensaje de un tercero puede provocar.

`motivo` es lo que hace legible el log. Sin él una fila dice "due_at cambió" y no hay forma de saber por qué; con él dice *"Ana avisó que la entrega se corre al viernes 18"*.

El agente puede no hacer nada. Es el caso mayoritario y no requiere herramienta.

### Alcance por chat como contención

El grupo de la facultad no puede tocar un item nacido en el chat de trabajo aunque alguien se lo pida explícitamente al modelo: la herramienta no lo encuentra. Los items creados desde la web tienen `source_jid` nulo y ningún agente los alcanza.

### Aplicación de tool calls

Cada tool call se aplica en una transacción que escribe el cambio en `items` **y** la fila correspondiente en `item_changes`, con `response_id` y `motivo`. No hay camino que modifique un item sin dejar log.

---

## 7. Flujos

### 7.1 Ingesta

```
webhook  ──▶ upsert chats (jid, nombre, es_grupo, last_seen_at)
             ¿body vacío? (sticker, reacción, media sin caption) → 200, fin
             ¿tracked?  no → 200, fin. No se persiste el texto.
                        sí → INSERT inbox (choca por wa_message_id si es reintento)
                             chats.pending_since = coalesce(pending_since, now)
                             chats.last_message_at = now
                             200
```

El chat se registra siempre (para poder listarlo en la UI de selección); **el contenido del mensaje solo se persiste si el chat está trackeado**.

### 7.2 Turno del agente

```
worker, cada 30 s:
  SELECT chats WHERE pending_since IS NOT NULL
    AND (now - last_message_at > 3 min OR now - pending_since > 15 min)
    FOR UPDATE SKIP LOCKED

  por cada chat:
    1. crear conversación si conversation_id IS NULL
    2. leer inbox del jid ordenado por sent_at, marcar claimed_at
    3. formatear la tanda
    4. responses.create(...)
    5. aplicar tool calls → items + item_changes   (transacción)
    6. borrar filas claimed, resetear agent_attempts
    7. re-armar pending_since:
         quedan filas sin claimar del jid → pending_since = min(sent_at) de esas filas
         no quedan                         → pending_since = NULL
```

El paso 7 no es cosmético. Mientras el turno corre siguen entrando mensajes, y el webhook hace
`pending_since = coalesce(pending_since, now)` — que **no** actualiza nada porque ya estaba seteado.
Si al terminar el turno se limpiara `pending_since` a secas, esos mensajes quedarían en `inbox`
sin que nadie los volviera a despachar hasta el mensaje siguiente. Se re-arma en función de lo
que quedó sin claimar.

El lock por fila de chat evita que dos tandas del mismo chat corran en paralelo y bifurquen la sesión. `SKIP LOCKED` permite escalar a varios workers sin coordinación extra. Chats distintos corren en paralelo: no comparten nada.

**Entrega at-least-once.** La llamada a OpenAI está fuera de la transacción. Si el proceso cae entre una llamada exitosa y el commit, la tanda se reintenta y el modelo la ve dos veces. Es tolerable porque las instructions llevan el snapshot de items abiertos, así que en el reintento el modelo ve el cambio ya aplicado y normalmente no actúa; y si actúa, queda en el log y se deshace. Perseguir exactly-once cuesta más complejidad de la que vale acá. Es una decisión, no un descuido.

### 7.3 Recordatorios

El worker corre cada 30 s y evalúa dos reglas:

- **Aviso puntual** — items con `due_at - LEAD` alcanzado, `done_at IS NULL` y `notified_at IS NULL`. `LEAD` por defecto 60 minutos, configurable por env. **Este es el único camino que escribe `items.notified_at`.**
- **Digest matinal** — a las 08:00 hora local, un mensaje con todo lo que vence hoy. Es informativo y **no** toca `notified_at`, así que un item que aparece en el digest igual recibe después su aviso puntual. Son dos señales distintas: "esto es lo de hoy" y "esto vence en una hora".

Items cuyo `due_at` tiene hora 00:00 (fecha sin hora) se avisan solo en el digest matinal, no a medianoche: para esos el digest marca `notified_at`.

### 7.4 Avisos de cambios del agente

Cada 5 minutos el worker junta los `item_changes` con `notified_at IS NULL` y manda **un** mensaje agrupado al chat propio. Un WhatsApp por cambio sería insoportable.

```
🔄 Bases de Datos II
   Moví "entregar TP3 de bases" — jue 13/8 → vie 18/8
   "Ana avisó que la entrega se corre al viernes 18"

➕ Equipo Backend
   Nuevo: "revisar PR de auth" — sin fecha
   "Marce lo pidió en el canal"

   deshacer: https://notia.tudominio/u/x7k2
```

### 7.5 Deshacer

`GET /u/:token`, donde el token son los primeros 10 caracteres del HMAC-SHA256 de `item_changes.id` en base64url, con un secreto del servidor — no hace falta columna. La ruta revierte el item usando la columna `antes`, escribe `undone_at`, y redirige a la PWA mostrando el resultado. Deshacer es idempotente: si `undone_at` ya está seteado, no hace nada y muestra el estado actual.

Se eligió link antes que "respondé 1 para deshacer" porque parsear respuestas obliga a mantener estado conversacional en el chat propio, que es justo el chat donde también se captura libremente — se pisarían.

---

## 8. Web app (PWA)

Instalable en celular y desktop. Online-only en v1 — la lectura offline del inbox cacheado queda para v2.

| Ruta | Contenido |
|---|---|
| `/` | Inbox: items abiertos, ordenados por `due_at` (los sin fecha al final) |
| `/buscar` | Full-text sobre `content` + filtro por tag y contexto |
| `/chats` | Lista de chats detectados con el toggle `tracked` |
| `/log` | `item_changes` cronológico con botón deshacer |
| `/item/:id` | Detalle y edición manual |

**Autenticación:** un solo usuario. Login con contraseña desde env, cookie HTTP-only de larga duración. No hay registro, ni recuperación, ni roles. Suficiente y honesto para lo que es.

La lista de `/chats` se puebla sola: todo chat del que llegue un webhook aparece ahí, ordenado por `last_seen_at`, aunque no esté trackeado.

---

## 9. Seguridad

### Inyección de prompt

Los mensajes de chats trackeados son **texto de terceros entrando a un LLM con herramientas de escritura**. Cualquiera en un grupo puede escribir instrucciones dirigidas al agente. Con sesión persistente el problema se agrava: un mensaje malicioso queda en el historial e influye en turnos futuros hasta que la compactación lo absorba.

Mitigaciones, en capas:

1. **Reglas frescas cada turno.** Con `conversation`, las `instructions` no se arrastran y se reescriben completas en cada llamada. El texto inyectado no compite contra reglas viejas: compite contra reglas de este turno, por un canal que WhatsApp no puede suplantar.
2. **Sin borrado.** La herramienta no existe.
3. **Alcance por chat.** `editar_item`, `cerrar_item` y `buscar_items` solo alcanzan items con `source_jid` = ese chat.
4. **Todo reversible y auditado.** Ningún camino modifica un item sin escribir `item_changes`.
5. **Los mensajes van etiquetados** con autor y hora (`[Juan 14:02] …`), de forma que el modelo los lea como testimonio de terceros y no como instrucción del operador.

Esto acota el daño; no lo elimina. El peor caso realista es un item basura creado o una fecha movida mal — visible en el digest y reversible con un tap.

### Otros

- Ningún secreto en el repo. `.env` fuera de git, montado por Compose.
- El webhook valida un token compartido con Evolution antes de procesar nada.
- Evolution es una librería **no oficial** de WhatsApp: existe riesgo de baneo del número. Decisión asumida explícitamente por el usuario.
- Postgres no se expone fuera de la red del Compose.

---

## 10. Errores y degradación

| Falla | Comportamiento |
|---|---|
| OpenAI caído o rate-limited | Se limpia `claimed_at` de las filas de esa tanda y se incrementa `chats.agent_attempts`. Backoff exponencial sobre `agent_attempts`; al llegar a 5 el chat se marca en la UI como "agente detenido" y deja de despacharse hasta que se destrabe manualmente. Los recordatorios **no** se ven afectados. |
| Evolution caído | Los avisos quedan con `notified_at` nulo y se reintentan. No se pierden. |
| `conversation_id` inválido o perdido | Se crea una conversación nueva. Se pierde historial de contexto, no datos: los items y el log son locales. |
| Webhook duplicado | El `UNIQUE` sobre `wa_message_id` lo descarta antes de tocar OpenAI. |
| Tool call con `id` fuera de alcance | La herramienta devuelve error al modelo; se loguea como intento rechazado. |
| Postgres caído | La API devuelve 503; Evolution reintenta el webhook. |

---

## 11. Supuestos a verificar antes de codear

1. **Semántica de `responses.create` sobre una conversación.** El diseño manda la tanda como `input` con `conversation` seteado. Verificar que los items previos de la conversación se incluyan en el contexto tal como se espera.
2. **ID determinístico de conversación.** No se pudo confirmar que el `conv_id` pueda elegirlo el cliente; todo indica que lo genera el servidor. El diseño no lo necesita —guarda el mapeo en `chats.conversation_id` y además escribe `metadata: { wa_jid }`—, pero conviene confirmarlo.
3. **Retención de conversaciones.** La doc indica que los items adjuntos a una conversación no están sujetos al TTL de 30 días. Confirmar antes de depender de eso.
4. **`store: false` / retención cero.** Si la cuenta tiene retención cero, la Conversations API no aplica y hay que caer al array de mensajes del lado nuestro. Verificar la configuración de la cuenta.
5. **Umbral del medidor de contexto largo de Luna.** Confirmar dónde está para asegurar que `compact_threshold: 40_000` queda por debajo.
6. **Formato del webhook de Evolution** para grupos: cómo llegan `jid`, nombre del grupo y autor del mensaje.

---

## 12. Testing

- **`core/agent`** — dado un array de tool calls simuladas, verificar que se apliquen correctamente a `items` y que quede la fila en `item_changes`. Sin red.
- **Alcance de herramientas** — un tool call que apunta a un item de otro chat debe ser rechazado. Test explícito, es una frontera de seguridad.
- **Dedup de ingesta** — el mismo `wa_message_id` dos veces produce una sola fila.
- **Despachador** — con reloj falso: la ventana de silencio dispara a los 3 min, el tope a los 15, y el lock impide procesamiento concurrente del mismo chat.
- **Scheduler** — con reloj falso: aviso puntual con lead, digest a las 08:00, items ya notificados no se re-notifican.
- **Deshacer** — revertir restaura exactamente `antes` y marca `undone_at`.
- **Integración del turno completo** — un test con la API de OpenAI mockeada, desde `inbox` hasta `item_changes`.

Un caso end-to-end real contra Evolution y OpenAI, corrido a mano antes de cada deploy.

---

## 13. Camino a v2

Ordenado por valor esperado:

1. **Instrucción por chat en lenguaje natural** — un textarea que entra a las instructions de ese chat. Es una columna nullable. Es la escape hatch prevista si algún grupo genera ruido.
2. **Web Push nativo** — segunda implementación de `notifier`; el worker no cambia.
3. **Extensión de navegador** — guardar la pestaña actual. Cliente fino de `POST /api/items`.
4. **CLI** — `notia add "…"`. Cliente fino de la misma API.
5. **Modo offline en la PWA** — lectura del inbox cacheado.
