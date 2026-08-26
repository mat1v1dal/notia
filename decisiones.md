# Decisiones

Bitácora del semestre. Cada TP agrega su sección abajo; lo anterior no se
reescribe.

---

## TP1 — Git colaborativo

### La app y el repositorio

Este repositorio es **notia**, un proyecto propio que ya existía antes de la
materia: un asistente que lee los chats de WhatsApp que uno elige, extrae de
ahí lo que compromete —una fecha, un pedido, un material— y lo deja en una
bandeja revisable y reversible.

Lo traje con **su historial completo** en vez de arrancar de cero. La
alternativa era un commit inicial que borrara los doce commits previos, y me
pareció peor: el historial muestra cómo se construyó el sistema, y eso es
justamente lo que la materia dice que sabe leer. Que parte del trabajo sea
anterior a la cursada está declarado acá y se ve en las fechas.

Verifiqué antes de publicarlo que el `.env` nunca hubiera entrado al
historial (`git log --all -- .env` vacío, y no figura en `git ls-files`). El
`.gitignore` ya lo excluía desde el primer commit.

### Por qué Git no pudo resolver el conflicto solo

El conflicto está en el [PR #3](../../pull/3). Dos ramas salieron del mismo
commit de `main` y las dos reescribieron **las mismas dos líneas** del bloque
de comandos del README:

- `fix/readme-estado-legible` cambió `docker compose ps` por su variante con
  `--format 'table ...'`.
- `fix/readme-comandos-de-diagnostico` cambió la línea de al lado, `logs -f
  notia-api`, por `logs -f` sin argumento, y reindentó los comentarios de todo
  el bloque para que quedaran alineados.

Cuando la primera se mergeó, la segunda quedó con una base que ya no existía.

Git hace el merge comparando **tres versiones** del archivo: la del ancestro
común, la de cada rama. Cuando una región cambió en un solo lado, la aplica
sin preguntar. Cuando la misma región cambió en los dos lados y de forma
distinta, no tiene ningún criterio para elegir: no sabe qué significa
`--format`, ni que los dos cambios eran complementarios y no alternativos.
Ve texto. Poner una heurística ahí sería peor que parar — elegiría mal en
silencio, que es exactamente el tipo de error que después nadie encuentra.

Lo resolví **quedándome con los dos lados**: las dos líneas sobrevivieron
porque documentaban cosas distintas. Esa decisión requiere entender para qué
sirve cada comando, y por eso la toma una persona.

**Qué habría tenido que pasar para que nunca apareciera.** Tres cosas, en
orden de lo que realmente se usa en un equipo:

1. Que las ramas fueran **cortas y se integraran seguido**. El conflicto nace
   de que dos ramas viven en paralelo sobre la misma región; cuanto menos
   tiempo pasan abiertas, menos probable es. Es la razón práctica detrás de
   integración continua, antes que cualquier herramienta.
2. Que cada rama tocara **una región distinta** del archivo. Acá las dos
   fueron a documentar el mismo bloque de seis líneas.
3. Que la segunda rama **se hubiera sincronizado con `main`** antes de pedir
   el merge. No evita el conflicto, pero lo mueve: se resuelve en la máquina
   de quien lo generó, con contexto fresco, en vez de aparecer en el PR.

Lo que **no** lo habría evitado es un merge distinto. Un rebase o un
squash tendrían el mismo conflicto: el problema no es la forma de integrar,
es que dos personas escribieron sobre lo mismo.

### Las protecciones sobre `main`

`main` quedó con **pull request obligatorio**, **cero aprobaciones
requeridas** y **sin bypass para administradores**.

Las cero aprobaciones no son una relajación de la regla: GitHub no deja que
el autor de un PR apruebe su propio PR (la opción aparece deshabilitada y la
API devuelve `422 — Can not approve your own pull request`). En un TP
individual, pedir una aprobación sería pedir algo que nadie puede dar. En un
equipo real acá iría 1 o más.

El *sin bypass* es la parte que importa: soy el dueño del repositorio, así
que sin eso la protección sería decorativa. Está verificado por la vía
directa — intenté pushear a `main` y GitHub me rechazó. La salida está en
[`evidencias.md`](evidencias.md).

Las configuré **por API** (`gh api --method PUT .../branches/main/protection`)
en vez de por la web. Misma regla, pero queda escrita y es reproducible: si
mañana tengo que recrear el repositorio, es un comando y no seis clics que
hay que recordar.

### La estrategia de ramas

Ramas por **unidad de cambio**, no por trabajo práctico: `feat/…` para lo que
agrega capacidad, `fix/…` para lo que corrige, `docs/…` para documentación,
y commits en formato convencional (`feat(docker): …`, `fix(api): …`).

Es la convención que el repositorio ya venía usando y es la que tiene sentido
para el Integrador: los TPs son capas sobre el mismo artefacto, no entregas
sueltas. Una rama `tp2` no dice nada sobre qué cambia; `feat/compose-tres-servicios`
sí. El número del TP queda registrado donde corresponde: en el tag y en la
release.

### Problemas encontrados

**El primer conflicto que fabriqué no fue un conflicto.** Armé dos ramas
sobre el mismo bloque del README y GitHub las mergeó sin chistar: una había
*agregado* una sección después del bloque y la otra había *modificado* el
bloque. Regiones adyacentes, no superpuestas — y Git resuelve eso solo. Tuve
que rehacerlo pisando literalmente los mismos renglones. El aprendizaje es
que "tocar el mismo archivo" no alcanza: el conflicto es por región, y la
región es más chica de lo que uno intuye.

**El contenedor de la API entraba en loop de reinicio.** Al pasar `tsx` de
las devDependencies de la raíz a las dependencias de `@notia/api`, su binario
dejó de estar en el `.bin` de la raíz y `pnpm exec tsx` no lo encontraba:
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`. Lo diagnostiqué mirando
`docker compose logs` y lo resolví agregando un script `start` al paquete, que
además es donde cualquiera lo buscaría. Está en el [PR #1](../../pull/1).

**Las rutas de estáticos tapaban los 404 reales.** Con el frontend en su
propio contenedor, la imagen de la API ya no lleva el build de la PWA y Hono
avisaba `serveStatic: root path 'public' is not found`. El warning era lo de
menos: las dos rutas son catch-all, así que cualquier 404 de la API se
respondía con un `index.html` que no existía. Ahora se montan solo si el
build está presente, y los dos modos de despliegue siguen andando.

### Declaración de uso de IA

Usé **Claude Code** como asistente en la parte de infraestructura de este TP.
Concretamente fue asistida la escritura de los dos Dockerfiles, el
`docker-compose.yml`, el `nginx.conf` y el README, además de la redacción de
este archivo y de `evidencias.md`.

No fue asistido el proyecto sobre el que se trabaja: `packages/core`, `api`,
`web` y `worker` —el modelo de dominio, las cuatro tablas y los 79 tests— son
anteriores a la materia. Tampoco lo fueron las decisiones de fondo del
práctico: publicar con el historial completo en vez de arrancar de cero, sacar
la capa de WhatsApp del arranque base, y ramificar por unidad de cambio en vez
de por TP.

**Cómo lo verifiqué.** No di nada por bueno por leerlo:

- **El stack levanta y responde.** `docker compose up -d` desde cero y `curl`
  contra las cuatro rutas: la SPA (`200 text/html`), el proxy al backend
  (`/salud → {"ok":true}`), la ruta protegida (`/api/items → 401`) y el
  fallback de la SPA (`/buscar → 200`). Las salidas están en `evidencias.md`.
- **La suite pasa entera**: `pnpm test` → 79/79 y `pnpm typecheck` limpio
  después de tocar `packages/api/src/index.ts`.
- **La protección rechaza de verdad.** No me alcanzó con que la API devolviera
  `enforce_admins: true`: intenté el push y guardé el rechazo.
- **Los dos bugs de la sección anterior aparecieron corriendo el sistema, no
  leyéndolo.** El loop de reinicio del contenedor y el catch-all de estáticos
  se vieron en `docker compose logs`. Es la razón por la que la verificación no
  puede ser una lectura.

Lo que **no** puedo declarar como verificado: no probé el stack completo
(`docker-compose.full.yml`) end-to-end, porque depende de una sesión de
WhatsApp viva. De ése solo validé la sintaxis con `docker compose config`.
