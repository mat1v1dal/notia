# Notia

Lo que tenés que hacer, incluso lo que no anotaste vos.

Notia observa los chats de WhatsApp que vos elegís, extrae de ahí lo que te
compromete —una fecha, un pedido, un material— y lo deja en una bandeja que
podés revisar, corregir y deshacer. Cada cambio queda registrado con el motivo
por el que se hizo: el sistema es auditable y reversible por diseño.

> Repositorio de la práctica de **Ingeniería del Software 3 — UCC 2026**.
> La app del semestre es ésta, y cada TP le agrega una capa del sistema de
> entrega. Ver [`decisiones.md`](decisiones.md) y [`evidencias.md`](evidencias.md).

---

## Arranque en una máquina limpia

Necesitás Docker con Compose. Nada más: no hace falta Node, ni pnpm, ni
ninguna credencial de un servicio externo.

```bash
git clone https://github.com/mat1v1dal/notia.git
cd notia

# 1. Los secretos son lo único que no viaja en el repositorio.
cp .env.example .env

# 2. Completá las cuatro variables del bloque "Stack base" del .env.
#    Para los secretos: openssl rand -base64 32

# 3. Arriba.
docker compose up -d
```

La app queda en **http://localhost:8080** (o el puerto que pongas en
`WEB_PORT`). Entrás con el valor que le hayas puesto a `APP_PASSWORD`.

Son **dos** comandos y no uno, y eso es a propósito: el `.env` con los
secretos no está versionado, así que la primera vez hay que crearlo.

Para verificar que el backend responde:

```bash
curl http://localhost:8080/salud   # → {"ok":true}
```

### Los tres servicios

| Servicio | Qué es | Imagen |
|---|---|---|
| `notia-web` | La PWA compilada, servida por nginx. Proxea `/api` al backend. | `Dockerfile.web` |
| `notia-api` | Hono + Drizzle. Corre las migraciones al arrancar. | `Dockerfile.api` |
| `postgres` | La base. Persiste en el volumen `pgdata`. | `postgres:16-alpine` |

```
navegador → notia-web (nginx :80) ──┬─→ estáticos de la SPA
                                    └─→ /api, /login, /u → notia-api :3000 → postgres :5432
```

Los servicios se encuentran **por nombre**: `notia-api` y `postgres` los
resuelve el DNS interno de la red de Compose. No hay ninguna IP en la
configuración.

### Comandos útiles

```bash
docker compose ps                  # estado y healthchecks
docker compose logs -f notia-api   # logs del backend
docker compose down                # baja todo, CONSERVA los datos
docker compose down -v             # baja todo y BORRA el volumen de la base
```

### Probar que los datos persisten

La diferencia entre `down` y `down -v` no es un detalle: es dónde vive el
estado del sistema. Se comprueba en treinta segundos.

```bash
# Creá un item desde la app, y después:
docker compose down       # se van los contenedores, queda el volumen
docker compose up -d      # el item sigue ahí

docker compose down -v    # esto sí borra el volumen
docker compose up -d      # base vacía: las migraciones corren de nuevo
```

---

## La capa opcional: ingesta por WhatsApp

El stack base es la app completa y usable: creás, buscás, cerrás y reabrís
items desde el navegador. Lo que le falta es la ingesta automática — el worker
que lee los chats y decide qué anotar.

Esa capa vive aparte porque depende de cosas que no controlamos: una API key
de OpenAI con saldo y una sesión de WhatsApp que se inicia escaneando un QR.

```bash
docker compose -f docker-compose.yml -f docker-compose.full.yml up -d
```

Requiere completar además el bloque opcional del `.env`. El motivo de esta
separación está explicado en [`decisiones.md`](decisiones.md).

---

## Desarrollo

```bash
pnpm install
docker compose up -d postgres          # solo la base

pnpm --filter @notia/api start         # backend en :3000
pnpm --filter @notia/web dev           # Vite en :5173, proxea /api al backend

pnpm test                              # 79 tests
pnpm typecheck
```

Vite emite el build a `packages/api/public`, así que en el modo de un solo
proceso la API sirve la PWA desde el mismo origen y no hay CORS.

## Estructura

```
packages/core     el dominio: items, ingesta, despacho, scheduler, agente, deshacer
packages/api      HTTP: Hono + Drizzle. Corre las migraciones al arrancar.
packages/web      la PWA: React + Vite
packages/worker   la ingesta: OpenAI + notificaciones por WhatsApp
```
