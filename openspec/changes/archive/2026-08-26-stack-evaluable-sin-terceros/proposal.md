# Propuesta — Stack evaluable sin dependencias de terceros

**Estado**: completada · **Archivada**: 2026-08-26
**Paquetes afectados**: `api`, `web`, `worker` (build y arranque). El dominio
(`core`) no se toca.

> 📌 Este documento se escribió **después** de implementar el cambio, como
> registro *as-built*. Las fechas de los commits son las reales: la
> implementación ocurrió el 2026-08-26 y esta documentación también.

## Contexto

notia se desplegaba como un stack de cinco servicios: `caddy`, `postgres`,
`evolution-api`, `notia-api` y `notia-worker`. Levantarlo requería una API key
de OpenAI con saldo y una sesión de WhatsApp iniciada escaneando un QR.

El proyecto pasa a ser la aplicación del semestre de Ingeniería del Software 3.
Eso agrega un requisito que antes no existía: **cualquiera tiene que poder
clonar el repositorio y levantar el sistema**, en una máquina limpia, sin
credenciales que no le podamos dar. En la defensa oral esto se hace en vivo.

## Problema

1. **El arranque depende de terceros que pueden fallar o vencer.** Si la API
   key no tiene saldo, o la sesión de WhatsApp expiró, el sistema no levanta —
   aunque el código esté perfecto. El riesgo no es hipotético: la sesión de
   WhatsApp se cae sola cada tanto y hay que re-escanear.
2. **El frontend no es desplegable por separado.** Vite emite a
   `packages/api/public` y la API lo sirve como estáticos. Funciona, pero
   significa que no hay una imagen del frontend: no se puede escalar, cachear
   ni desplegar independientemente del backend.
3. **La imagen de la API lleva el toolchain entero.** El `Dockerfile` copiaba
   `node_modules` completo, con typescript, vitest, vite y drizzle-kit adentro.

## Propuesta

Partir el despliegue en dos niveles.

**Nivel base — `docker-compose.yml`.** Tres servicios: `notia-web` (nginx
sirviendo la SPA y proxeando al backend), `notia-api` y `postgres`. Levanta con
dos comandos y **cuatro variables de entorno**, ninguna de un servicio externo.
Es el sistema completo salvo la ingesta automática.

**Nivel completo — `docker-compose.full.yml`.** Agrega `notia-worker`,
`evolution-api` y (bajo perfil `produccion`) `caddy`. Es opt-in explícito.

Además: dos Dockerfiles multi-stage, uno por imagen, para que lo que se
despliega no arrastre el toolchain de build.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Dejar todo en un compose y documentar que hace falta la API key | No resuelve el problema: el sistema sigue sin levantar sin credenciales ajenas. |
| Stubear OpenAI y Evolution con un mock en el compose base | Un mock en el arranque es una mentira operativa: quien levanta el sistema cree que funciona la ingesta. Preferimos que la capa esté ausente y declarada. |
| Sacar el worker del repositorio | El worker es parte del producto. El problema es el arranque, no el código. |
| Perfiles de Compose (`profiles:`) en un solo archivo | Se probó mentalmente y se descartó: los perfiles no permiten cambiar `depends_on` ni agregar volúmenes al servicio de otro perfil sin ensuciar el archivo base. Dos archivos leen mejor. Se conserva `profiles` sólo para `caddy`, que sí es un agregado puro. |

## Criterios de aceptación

- Un clone limpio levanta el sistema con `cp .env.example .env && docker compose up -d`.
- Ninguna variable requerida por el nivel base pertenece a un servicio de terceros.
- La suite (`pnpm test`) y el typecheck siguen pasando.
- El nivel completo sigue siendo levantable con un comando.

## Plan de rollback

El cambio es puramente de empaquetado y arranque: no toca el dominio ni el
schema de la base. Revertir es `git revert` del merge del PR #1 — el volumen
`pgdata` y sus datos no se ven afectados porque el nombre del volumen y el del
servicio de Postgres no cambian.

Único punto de atención: el `docker-compose.override.yml` que se eliminó fijaba
los puertos. Al revertir hay que verificar que `WEB_PORT` no quede colgado.
