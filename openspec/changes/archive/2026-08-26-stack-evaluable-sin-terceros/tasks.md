# Tareas — Stack evaluable sin dependencias de terceros

Todas completadas el 2026-08-26. Entre paréntesis, el commit.

## 1. Preparación

- [x] 1.1 Ignorar la configuración local del agente (`09fb8e1`)
- [x] 1.2 Reclasificar `tsx` como dependencia de producción de `api` y `worker`,
      y regenerar el lockfile (`e9757a4`)

## 2. Imágenes

- [x] 2.1 `Dockerfile.api` multi-stage: `deps` → `prod-deps` → `runtime` (`844799c`)
- [x] 2.2 `.dockerignore` en la raíz — el contexto de build es el monorepo
      entero, así que es uno solo y no uno por paquete (`844799c`)
- [x] 2.3 `Dockerfile.web` multi-stage: build con Node → nginx (`25bc38a`)
- [x] 2.4 `packages/web/nginx.conf` con el proxy por nombre de servicio y el
      `try_files` de la SPA (`25bc38a`)

## 3. Orquestación

- [x] 3.1 `docker-compose.yml` reducido a `postgres` + `notia-api` + `notia-web`,
      con volumen nombrado y healthcheck de Postgres (`fb6ae38`)
- [x] 3.2 `docker-compose.full.yml` con `notia-worker`, `evolution-api` y
      `caddy` bajo perfil `produccion` (`fb6ae38`)
- [x] 3.3 Eliminar `docker-compose.override.yml`; los puertos pasan a
      `WEB_PORT` y `EVOLUTION_PORT` con default (`fb6ae38`)
- [x] 3.4 `.env.example` partido en bloque base (4 variables) y bloque
      opcional, comentado (`fb6ae38`)
- [x] 3.5 Apuntar el `Caddyfile` a `notia-web`, que pasa a ser el punto de
      entrada (`fb6ae38`)

## 4. Correcciones surgidas al ejecutar

> Las dos aparecieron levantando los contenedores, no leyendo el código.

- [x] 4.1 Arrancar la API por `pnpm --filter @notia/api start`: `pnpm exec tsx`
      se resolvía contra el `.bin` de la raíz y el contenedor entraba en loop
      de reinicio con `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` (`9aa94c8`)
- [x] 4.2 Montar los estáticos de la API sólo si el build está presente: las
      dos rutas son catch-all y tapaban los 404 reales (`8479f03`)

## 5. Documentación

- [x] 5.1 README con el arranque en máquina limpia, la topología de los tres
      servicios y la capa opcional (`59f1c66`)
- [x] 5.2 Comandos de diagnóstico y receta de prueba de persistencia
      (PRs #2, #3, #4)

## 6. Verificación

- [x] 6.1 `pnpm typecheck` limpio tras tocar `packages/api/src/index.ts`
- [x] 6.2 `pnpm test` → 79/79
- [x] 6.3 Arranque desde cero y `curl` contra las cuatro rutas
- [x] 6.4 `docker compose config` sobre el nivel completo
- [ ] 6.5 Verificación funcional end-to-end del nivel completo — **no hecha**:
      requiere una sesión de WhatsApp viva. Declarada en el reporte.
