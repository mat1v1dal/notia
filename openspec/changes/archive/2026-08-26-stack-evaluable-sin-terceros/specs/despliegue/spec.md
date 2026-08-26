# Delta spec — Despliegue

Cambios sobre la capability `despliegue`. Convención RFC 2119.

## ADDED — Arranque sin dependencias de terceros

El sistema MUST poder levantarse completo, y quedar usable desde el navegador,
sin credenciales de ningún servicio externo.

El nivel base MUST requerir exactamente cuatro variables de entorno:
`POSTGRES_PASSWORD`, `APP_PASSWORD`, `APP_SECRET` y `WEBHOOK_TOKEN`. Ninguna de
ellas SHALL pertenecer a un servicio de terceros. `WEB_PORT` MAY definirse y
SHALL tener un valor por defecto.

### Escenario: clone limpio

- **Given** una máquina con Docker y sin el repositorio
- **When** se clona, se corre `cp .env.example .env`, se completan las cuatro
  variables y se ejecuta `docker compose up -d`
- **Then** los tres servicios quedan arriba, `GET /` devuelve `200 text/html` y
  `GET /salud` devuelve `{"ok":true}`

### Escenario: sin credenciales de terceros

- **Given** un `.env` con el bloque opcional entero comentado
- **When** se levanta el nivel base
- **Then** el sistema arranca y es usable; la ingesta automática no ocurre y
  ninguna otra funcionalidad se degrada

## ADDED — Frontend desplegable por separado

El frontend MUST publicarse como su propia imagen, servida por nginx, sin Node
ni código fuente en la imagen final.

nginx MUST proxear `/api`, `/login`, `/u`, `/salud` y `/webhook` hacia el
backend **por nombre de servicio**, de modo que el navegador vea un solo
origen. La configuración SHALL NOT contener direcciones IP.

Las rutas desconocidas MUST resolverse devolviendo `index.html`, para que las
resuelva el router del cliente.

### Escenario: ruta del router del cliente

- **Given** el sistema levantado
- **When** se pide `GET /buscar`, que no corresponde a ningún archivo
- **Then** nginx devuelve `200` con el `index.html`

### Escenario: la sesión se sigue exigiendo a través del proxy

- **Given** el sistema levantado y ninguna cookie de sesión
- **When** se pide `GET /api/items`
- **Then** la respuesta es `401` — el proxy no debilita la autenticación

## ADDED — Imágenes sin toolchain de build

Cada imagen desplegable MUST construirse con un Dockerfile multi-stage cuya
etapa final NO SHALL contener las devDependencies ni las herramientas de build.

La imagen del frontend SHALL NOT contener Node.

### Escenario: la imagen final es más chica que la de build

- **Given** el `Dockerfile.api`
- **When** se construyen la etapa `deps` y la etapa `runtime`
- **Then** `runtime` es sensiblemente menor que `deps`

## ADDED — Persistencia de la base

Los datos MUST sobrevivir a `docker compose down` y MUST borrarse con
`docker compose down -v`.

La API MUST esperar a que Postgres acepte conexiones —no sólo a que el
contenedor arranque— mediante un `healthcheck` referenciado por `depends_on`.

### Escenario: los datos sobreviven al ciclo

- **Given** un item creado desde la app
- **When** se corre `docker compose down` y después `docker compose up -d`
- **Then** el item sigue estando

### Escenario: `down -v` limpia

- **Given** un item creado
- **When** se corre `docker compose down -v` y después `up -d`
- **Then** la base arranca vacía y las migraciones vuelven a correr

## MODIFIED — Servicio de estáticos de la API

**Antes**: la API montaba incondicionalmente dos rutas catch-all que servían
`packages/api/public`.

**Ahora**: esas rutas MUST montarse **sólo si el directorio existe**. Cuando el
frontend se sirve desde su propia imagen, la API SHALL responder sus propios
404 en vez de un `index.html` inexistente.

### Escenario: la API sin el build presente

- **Given** la imagen de la API, que no incluye `packages/api/public`
- **When** se pide una ruta inexistente
- **Then** la respuesta es el 404 de la API, y el arranque no emite el aviso
  `serveStatic: root path 'public' is not found`

## REMOVED — `docker-compose.override.yml`

Fijaba puertos para esta máquina en particular. Los puertos ahora salen de
`WEB_PORT` y `EVOLUTION_PORT`, con valor por defecto. Un override sin
versionar SHOULD ser la vía para ajustes locales, no un archivo commiteado.
