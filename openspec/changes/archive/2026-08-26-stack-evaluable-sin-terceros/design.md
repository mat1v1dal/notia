# Diseño — Stack evaluable sin dependencias de terceros

## Topología resultante

```
                    ┌──────────────────────────────────────┐
  navegador ───────▶│ notia-web   nginx :80                │
                    │  · estáticos de la SPA               │
                    │  · try_files → index.html            │
                    └──────────┬───────────────────────────┘
                               │ /api /login /u /salud /webhook
                               ▼
                    ┌──────────────────────────────────────┐
                    │ notia-api   Hono :3000               │
                    │  · migra al arrancar (connect())     │
                    └──────────┬───────────────────────────┘
                               │ DATABASE_URL
                               ▼
                    ┌──────────────────────────────────────┐
                    │ postgres :5432   volumen `pgdata`    │
                    └──────────────────────────────────────┘

  ─ ─ ─ ─ ─ ─ ─ ─ ─ docker-compose.full.yml ─ ─ ─ ─ ─ ─ ─ ─ ─
  notia-worker ──▶ OpenAI          evolution-api ──▶ WhatsApp
```

Los servicios se encuentran por nombre: el DNS interno de la red de Compose
resuelve `notia-api` y `postgres`. No hay una sola IP en la configuración.

## Secuencia de arranque

```
compose            postgres          notia-api           notia-web
   │                  │                  │                   │
   ├─ up ────────────▶│                  │                   │
   │                  ├─ init            │                   │
   │◀─ healthcheck ───┤  pg_isready      │                   │
   │   (cada 5s,      │                  │                   │
   │    hasta 10x)    │                  │                   │
   │                  │                  │                   │
   ├─ service_healthy ──────────────────▶│                   │
   │                  │                  ├─ connect()        │
   │                  │◀─ migrate ───────┤                   │
   │                  │                  ├─ serve :3000      │
   │◀─ /salud ────────────────────────────┤                   │
   │                  │                  │                   │
   ├─ started ────────────────────────────────────────────────▶│
   │                  │                  │◀── proxy_pass ────┤
```

El `healthcheck` es lo que hace correcta la secuencia. `depends_on` a secas
sólo espera a que el contenedor **arranque**; Postgres tarda varios segundos
más en aceptar conexiones, y en ese hueco `migrate()` falla.

## Decisiones

### D1 — Dos archivos de compose, no perfiles

**Decisión.** El nivel base y el completo viven en archivos separados que se
componen con `-f`.

**Por qué.** Los perfiles de Compose activan o desactivan servicios, pero no
permiten que un servicio de un perfil **modifique** a otro del archivo base.
La capa de WhatsApp necesita agregarle a `postgres` un volumen
—el script que crea la base de Evolution— que el nivel base no debe tener. Eso
no se puede expresar con `profiles` sin meter en el archivo base configuración
que sólo aplica a veces.

**Alternativas.** Un solo archivo con `profiles` en cada servicio: se
descartó por lo anterior. Dos stacks completamente independientes: duplica la
definición de `postgres` y las dos copias divergen.

**Excepción.** `caddy` sí queda bajo `profiles: ["produccion"]`, porque es un
agregado puro — no modifica a nadie.

### D2 — Multi-stage por poda de dependencias, no por compilación

**Decisión.** El `Dockerfile.api` tiene tres etapas —`deps`, `prod-deps`,
`runtime`— y la final copia sólo las dependencias de producción y el código
TypeScript, que se ejecuta con tsx.

**Por qué.** El proyecto corre TypeScript directamente por diseño: los
`tsconfig` tienen `noEmit: true` y los paquetes exportan `.ts`. La razón
original está en el código: *"no hay paso de build que pueda quedar
desincronizado con lo que testeamos"*. Introducir un `tsc` que emita a `dist`
para tener un multi-stage "clásico" habría cambiado esa propiedad a cambio de
nada: el peso no está en el código, está en el toolchain.

Lo que se descarta entre `deps` y `runtime` es typescript, vitest, vite,
drizzle-kit y sus árboles. **552MB → 342MB.**

**Consecuencia aceptada.** La imagen de la API lleva el código fuente. Para
este proyecto no es un problema — el repositorio es público.

### D3 — El frontend se despliega de dos formas y comparte artefacto

**Decisión.** `vite.config.ts` sigue emitiendo a `packages/api/public`, y el
`Dockerfile.web` copia desde ahí.

**Por qué.** Preserva el modo de un solo proceso (la API sirviendo la PWA, un
origen, sin CORS) que es el que se usa en desarrollo, y a la vez habilita la
imagen separada. El mismo artefacto sirve para los dos: no hay dos builds que
puedan divergir.

**Costo.** El `Dockerfile.web` copia desde una ruta que nombra a otro paquete,
lo que se lee raro. Está comentado en el archivo.

### D4 — Montar los estáticos condicionalmente

**Decisión.** `packages/api/src/index.ts` monta las rutas de estáticos sólo si
el directorio existe.

**Por qué.** Es consecuencia directa de D3. Las dos rutas son catch-all
(`app.use("/*")` y `app.get("*")`), así que sin el build presente cualquier 404
de la API se respondía con un `index.html` inexistente — el 404 real quedaba
tapado. El aviso `serveStatic: root path 'public' is not found` era el síntoma
visible de un problema más grande.

### D5 — `tsx` es dependencia de producción

**Decisión.** `tsx` pasa de las devDependencies de la raíz a las dependencies
de `@notia/api` y `@notia/worker`, y ambos ganan un script `start`.

**Por qué.** Si el código de producción se ejecuta con tsx, tsx es una
dependencia de producción — estaba mal clasificado desde antes, y la poda de
`pnpm install --prod` lo expuso.

**Consecuencia.** El binario queda en el `.bin` del paquete y no en el de la
raíz, así que `pnpm exec tsx` desde la raíz deja de encontrarlo. Por eso el
arranque pasa a ser `pnpm --filter @notia/api start`, que resuelve contra el
paquete correcto.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El nivel completo se rompe sin que nadie lo note, porque no está en el arranque base | `docker compose config` valida su sintaxis. Su verificación funcional queda pendiente y está declarada como tal en el reporte. |
| `evolution-api` usa el tag `latest` | Preexistente. Fijar una versión queda para un cambio aparte. |
