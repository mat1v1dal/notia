# AGENTS.md

Cómo trabaja un agente de IA sobre este repositorio. **Leer antes de tocar
nada.** Las reglas de acá tienen precedencia sobre el comportamiento por
defecto de cualquier skill.

## El contexto que cambia todo

notia es la aplicación del semestre de **Ingeniería del Software 3 (UCC 2026)**.
Eso agrega dos requisitos que no tendría un proyecto personal:

1. El repositorio es **público** y su historial de Git es evidencia evaluada.
2. Todo lo que hay acá adentro tiene que poder **defenderse oralmente**, sin la
   IA presente. *Si no se puede explicar, no se aprueba — aunque funcione.*

## Antes de escribir código

Leé, en este orden:

| Archivo | Qué te dice |
|---|---|
| `openspec/specs/flujo-de-trabajo/spec.md` | Cómo entra el código y las cuatro condiciones del uso de IA |
| `openspec/specs/despliegue/spec.md` | Cómo se empaqueta y arranca el sistema |
| `openspec/config.yaml` | Stack detectado y reglas por fase |
| `decisiones.md` | Qué se decidió antes y por qué |

## Las cuatro reglas

**Declarar.** Lo que hiciste va a `decisiones.md`, específico: qué archivos,
qué decisiones. No una fórmula genérica.

**Verificar ejecutando.** `pnpm test` (79 tests) y `pnpm typecheck` antes de
abrir el PR. Si tocaste el despliegue, levantá el sistema y guardá la salida.
Los dos bugs del cambio `stack-evaluable-sin-terceros` aparecieron corriendo
los contenedores, no leyendo el diff.

**Dejarlo defendible.** Cada decisión de arquitectura con su porqué y las
alternativas que descartaste. Las alternativas son lo que se pregunta.

**No fabricar evidencia.** No toques fechas de commits ni reescribas el
historial para sugerir un orden que no ocurrió. Documentar después de
implementar está bien; hacerlo pasar por anterior, no.

## Convenciones del código

- **`core` no conoce transporte.** El dominio no sabe que existen HTTP ni
  WhatsApp. Si una regla de negocio necesita un `Context` de Hono, está en el
  paquete equivocado.
- **Sin mocks de la base.** Los tests levantan una PGlite en memoria con las
  **mismas migraciones** que corren en producción (`packages/core/src/testing.ts`).
  No introduzcas un mock de `IMongoCollection`-style: rompe la única propiedad
  que hace confiables a estos tests.
- **Toda mutación de un item escribe en `item_changes`.** Con su motivo. Es lo
  que hace al sistema auditable y reversible; un camino que lo saltee es un bug.
- **El backend corre TypeScript directo**, con tsx. `noEmit: true` en todos los
  `tsconfig` es deliberado: no hay build que pueda desincronizarse de lo que se
  testea. No agregues un paso de compilación sin discutirlo.
- **Los comentarios explican el porqué.** El diff ya dice el qué.

## Ramas

`feat/`, `fix/`, `docs/`, `chore/` — por unidad de cambio. **Nunca** `tp2` ni
`entrega-3`: el número del práctico va en el tag y en la release.

`main` está protegida sin bypass. No intentes pushear directo; no vas a poder,
y está bien que sea así.

## Comandos

```bash
pnpm test                              # 79 tests
pnpm typecheck
docker compose up -d                   # los tres servicios del nivel base
docker compose logs -f notia-api
```
