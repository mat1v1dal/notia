# Reporte de verificación

**Cambio**: stack-evaluable-sin-terceros · **Fecha**: 2026-08-26
**Veredicto**: aprobado con una salvedad declarada (§ Pendiente).

## Escenarios de la spec

| Spec | Escenario | Resultado |
|---|---|---|
| Arranque sin terceros | Clone limpio levanta el sistema | ✅ |
| Arranque sin terceros | Sin credenciales de terceros | ✅ |
| Frontend separado | Ruta del router del cliente | ✅ |
| Frontend separado | La sesión se sigue exigiendo por el proxy | ✅ |
| Imágenes sin toolchain | La final es más chica que la de build | ✅ |
| Persistencia | Los datos sobreviven al ciclo | ⚠️ ver abajo |
| Persistencia | `down -v` limpia | ⚠️ ver abajo |
| Estáticos de la API | Sin el build presente | ✅ |

## Evidencia

**Los tres servicios, sanos.**

```console
$ docker compose ps --format 'table {{.Service}}\t{{.Status}}'
SERVICE     STATUS
notia-api   Up 6 seconds (healthy)
notia-web   Up 2 minutes
postgres    Up 2 minutes (healthy)
```

**End-to-end a través de nginx.**

```console
$ curl -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:8099/
200 text/html
$ curl http://localhost:8099/salud
{"ok":true}
$ curl -o /dev/null -w "%{http_code}\n" http://localhost:8099/api/items
401
$ curl -o /dev/null -w "%{http_code}\n" http://localhost:8099/buscar
200
```

El `401` es el escenario que más importa: confirma que meter un proxy delante
no debilitó la autenticación.

**Tamaños.**

```console
notia-api-deps (etapa intermedia)   552MB
notia-notia-api                     342MB     ← -38%
notia-notia-web                      92.1MB   ← nginx + estáticos, sin Node
```

**Suite y tipos.**

```console
$ pnpm test
 Test Files  9 passed (9)
      Tests  79 passed (79)

$ pnpm typecheck
(sin salida)
```

**Sintaxis del nivel completo.**

```console
$ docker compose -f docker-compose.yml -f docker-compose.full.yml config --quiet
(sin salida: válido)
```

## Salvedades

**Persistencia (escenarios 6 y 7): verificada por construcción, no por
ejecución.** El volumen nombrado `pgdata` y el `healthcheck` están en el
compose y el ciclo `down` / `up` se documentó en el README, pero **no se
ejecutó el ciclo completo creando un item y comprobando que sobrevive**. La
razón es que el entorno de prueba comparte el volumen con datos reales. Queda
como evidencia a producir en el TP2, donde el enunciado la pide explícitamente.

## Pendiente

**6.5 — verificación funcional del nivel completo.** No se levantó
`docker-compose.full.yml` end-to-end: depende de una sesión de WhatsApp viva y
de consumo real contra OpenAI. Sólo se validó su sintaxis.

Esto es exactamente el riesgo que el cambio buscaba acotar, y es coherente que
quede así: la capa que no se puede verificar en cualquier máquina es la que se
sacó del camino crítico.
