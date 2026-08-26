# Capability: Despliegue

Fuente de verdad del empaquetado y arranque de notia. Refleja el estado
*as-built*. Los deltas que la formaron están en
`openspec/changes/archive/`.

Convención RFC 2119.

## Niveles de despliegue

El sistema MUST distinguir dos niveles:

| Nivel | Archivo | Contiene |
|---|---|---|
| Base | `docker-compose.yml` | `notia-web`, `notia-api`, `postgres` |
| Completo | `+ docker-compose.full.yml` | `notia-worker`, `evolution-api`, `caddy` (perfil `produccion`) |

**Regla que gobierna la partición**: todo servicio cuyo arranque dependa de una
credencial de terceros, de un servicio pago o de una sesión que un humano deba
iniciar a mano MUST vivir en el nivel completo. El nivel base SHALL ser
levantable por cualquiera, en cualquier máquina con Docker.

Un cambio que agregue una dependencia de terceros al nivel base es una
**violación de esta spec**, no un detalle de implementación.

## Configuración

El nivel base MUST requerir exactamente estas variables:

| Variable | Para qué | Default |
|---|---|---|
| `POSTGRES_PASSWORD` | credencial de la base | — |
| `APP_PASSWORD` | contraseña única de la app | — |
| `APP_SECRET` | firma de cookie de sesión y tokens de deshacer | — |
| `WEBHOOK_TOKEN` | header `apikey` que valida el webhook | — |
| `WEB_PORT` | puerto publicado | `8080` |

Los secretos SHALL vivir en un `.env` no versionado, con un `.env.example`
versionado. El `.env` MUST NOT entrar nunca al historial de Git ni al contexto
de build de una imagen.

La cadena de conexión a la base MUST ser parametrizable por variable de entorno
sin tocar código. Ningún servicio SHALL referirse a otro por dirección IP: se
encuentran por nombre, vía el DNS de la red de Compose.

## Arranque

La API MUST esperar a que Postgres **acepte conexiones** —vía `healthcheck`
referenciado desde `depends_on` con `condition: service_healthy`— y no
solamente a que el contenedor arranque.

La API MUST correr las migraciones al arrancar. El worker las SHALL asumir
hechas y depender de que la API esté sana.

La API MUST exponer `GET /salud`, que devuelve `{"ok":true}`.

### Escenario: clone limpio

- **Given** una máquina con Docker y sin el repositorio
- **When** se clona, `cp .env.example .env`, se completan las variables y
  `docker compose up -d`
- **Then** los tres servicios quedan arriba y la app responde en `WEB_PORT`

## Imágenes

Cada imagen desplegable MUST construirse multi-stage, y su etapa final
SHALL NOT contener devDependencies ni herramientas de build. La imagen del
frontend SHALL NOT contener Node.

El contexto de build es la raíz del monorepo —pnpm necesita el lockfile y todos
los `package.json` para resolver el workspace—, así que hay **un solo**
`.dockerignore`, en la raíz.

Toda dependencia que el código de producción necesite en tiempo de ejecución
MUST estar declarada como `dependency`, no como `devDependency`. Esto incluye
`tsx`, porque el backend ejecuta TypeScript directamente.

## Frontend

El frontend MUST ser desplegable de dos formas, compartiendo un único
artefacto de build:

1. Servido por nginx en su propia imagen (nivel base).
2. Servido por la API como estáticos, en un solo proceso (desarrollo).

nginx MUST proxear `/api`, `/login`, `/u`, `/salud` y `/webhook` hacia
`notia-api`, de modo que el navegador vea un solo origen. Las rutas
desconocidas MUST devolver `index.html`.

La API MUST montar sus rutas de estáticos **sólo si el build está presente**:
son catch-all y taparían sus propios 404.

### Escenario: la sesión se sigue exigiendo por el proxy

- **Given** el sistema levantado y ninguna cookie
- **When** `GET /api/items`
- **Then** `401`

## Persistencia

Los datos de la base MUST vivir en un volumen nombrado, sobrevivir a
`docker compose down` y borrarse con `docker compose down -v`.
