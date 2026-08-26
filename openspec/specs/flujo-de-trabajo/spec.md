# Capability: Flujo de trabajo

Cómo entra el código a este repositorio, y bajo qué condiciones puede hacerlo
un agente de IA. Convención RFC 2119.

## Integración

`main` MUST estar protegida: todo cambio entra por pull request, **sin bypass
para administradores**. La protección SHALL configurarse por API, no por la
web, para que quede escrita y sea reproducible:

```bash
gh api --method PUT "repos/{owner}/{repo}/branches/main/protection" --input - <<'EOF'
{ "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "required_status_checks": null, "enforce_admins": true, "restrictions": null }
EOF
```

Las aprobaciones requeridas van en **cero** mientras el repositorio tenga un
solo colaborador: GitHub no permite aprobar el propio PR, así que exigir una
haría el merge imposible. Con un segundo colaborador, esto SHOULD subir a 1.

## Ramas y commits

Las ramas MUST nombrarse por **unidad de cambio**, nunca por entrega:

| Prefijo | Para |
|---|---|
| `feat/` | agrega capacidad |
| `fix/` | corrige comportamiento |
| `docs/` | documentación |
| `chore/` | mantenimiento sin efecto funcional |

Una rama `tp2` o `entrega-3` es una **violación de esta spec**. El número del
trabajo práctico se registra donde corresponde: en el tag y en la release.

Los commits MUST seguir el formato convencional (`feat(docker): …`). El cuerpo
SHOULD explicar **por qué**, no repetir el qué — el diff ya dice el qué.

Cada trabajo práctico MUST cerrarse con un tag `vN.0.0` y su release
publicada. Si un TP ya etiquetado se corrige, el tag SHALL moverse y el
movimiento SHALL registrarse en `decisiones.md`.

## Uso de IA

Un agente MAY escribir código, configuración y documentación en este
repositorio. Las siguientes condiciones son **innegociables** y derivan del
reglamento de la cátedra:

### 1. Declarado

Toda contribución asistida por IA MUST declararse en `decisiones.md`, indicando
qué partes fueron asistidas y cuáles no. La declaración SHALL ser específica
—qué archivos, qué decisiones— y SHALL NOT ser una fórmula genérica.

### 2. Verificado por ejecución, no por lectura

Ningún cambio SHALL darse por bueno porque "se ve bien". Antes de abrir el PR:

- `pnpm test` MUST pasar entero
- `pnpm typecheck` MUST estar limpio
- Si el cambio toca el despliegue, el sistema MUST levantarse y responder —
  con la salida guardada

La declaración de IA MUST incluir **cómo** se verificó cada parte, y MUST
declarar explícitamente lo que **no** se pudo verificar.

> Los dos bugs del cambio `stack-evaluable-sin-terceros` aparecieron al
> levantar los contenedores, no al leer el diff. Ésa es la razón de esta regla.

### 3. Defendible

Toda decisión que tomó la IA MUST poder explicarse sin la IA presente. Un
cambio que funciona pero que no se puede defender **no está terminado**.

De ahí sale la exigencia sobre `design.md`: cada decisión de arquitectura
SHALL registrar su porqué y las alternativas descartadas. Las alternativas
son lo que se pregunta en una defensa.

### 4. Sin fabricar evidencia

Un agente MUST NOT alterar fechas de commits, reescribir el historial para
sugerir un orden de trabajo que no ocurrió, ni presentar como verificado algo
que no se ejecutó.

La documentación escrita **después** de implementar es legítima y SHOULD
marcarse como *as-built*. Hacerla pasar por anterior, no.

## Specs

Un cambio no trivial SHOULD producir sus artefactos en
`openspec/changes/{nombre}/` antes de implementarse, y archivarse en
`openspec/changes/archive/YYYY-MM-DD-{nombre}/` al terminar, con las deltas
mergeadas a `openspec/specs/`.

El archivo es un **registro de auditoría**: un change archivado MUST NOT
modificarse ni borrarse.
