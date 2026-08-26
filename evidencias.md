# Evidencias

---

## TP1 — Git colaborativo

### 1. Push directo a `main` rechazado

La protección alcanza también al dueño del repositorio (*Do not allow
bypassing*). Intento real contra `origin/main`:

```console
$ echo "" >> .gitignore
$ git commit -am "test: intento de push directo"
$ git push
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote:
remote: - Changes must be made through a pull request.
To https://github.com/mat1v1dal/notia.git
 ! [remote rejected] main -> main (protected branch hook declined)
error: failed to push some refs to 'https://github.com/mat1v1dal/notia.git'
```

`protected branch hook declined` es el rechazo del lado del servidor: el
commit existía en local, pero nunca llegó a `main`. Después se deshizo con
`git reset --hard HEAD~1`.

La configuración que lo produce:

```console
$ gh api repos/mat1v1dal/notia/branches/main/protection \
    -q '{pr: .required_pull_request_reviews.required_approving_review_count, sin_bypass: .enforce_admins.enabled}'
{"pr":0,"sin_bypass":true}
```

> 📸 **Falta la captura de pantalla** de *Settings → Branches* con la regla
> configurada. Sacarla antes de entregar.

### 2. El PR con el conflicto

[PR #3 — *docs: comandos de diagnóstico de los tres servicios*](../../pull/3)

Al mergearse el [PR #4](../../pull/4), que reescribió las mismas dos líneas
del README, GitHub marcó el #3 como no mergeable:

```console
$ gh pr view 3 --json number,mergeable,mergeStateStatus
{"mergeStateStatus":"DIRTY","mergeable":"CONFLICTING","number":3}
```

En la web esto se ve como *"This branch has conflicts that must be resolved"*
con el botón de merge deshabilitado.

> 📸 **Falta la captura** del PR #3 mostrando ese aviso. GitHub ya no lo
> muestra porque el PR está mergeado — se puede recrear el estado en una rama
> descartable, o sacarla la próxima vez.

### 3. Los marcadores del conflicto

Traer `main` a la rama para resolver en local:

```console
$ git merge origin/main
Auto-merging README.md
CONFLICT (content): Merge conflict in README.md
Automatic merge failed; fix conflicts and then commit the result.
```

Y el archivo, con las dos versiones enfrentadas:

```text
docker compose ps --format 'table {{.Service}}\t{{.Status}}'   # estado legible
docker compose logs -f notia-api   # logs del backend
docker compose down                # baja todo, CONSERVA los datos
docker compose down -v             # baja todo y BORRA el volumen de la base
```

- `<<<<<<< HEAD` … `=======` → lo que traía **mi rama**.
- `=======` … `>>>>>>> origin/main` → lo que traía **main**.

Resuelto quedándome con los dos lados: eran cambios complementarios. El
razonamiento está en [`decisiones.md`](decisiones.md).

### 4. La release publicada

Tag `v1.0.0` sobre `main`, con su release en la pestaña *Releases*.

> 📸 **Falta la captura** de la release publicada.

---

## Anexo — el sistema funcionando

No lo pide el TP1, pero es lo que respalda que el repositorio tiene una app
adentro y no solo configuración de Git.

### Los tres servicios arriba

```console
$ cp .env.example .env    # y completar las cuatro variables
$ docker compose up -d
$ docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
SERVICE     STATUS                    PORTS
notia-api   Up 6 seconds (healthy)
notia-web   Up 2 minutes              0.0.0.0:8099->80/tcp
postgres    Up 2 minutes (healthy)
```

### End-to-end, a través de nginx

```console
$ curl -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:8099/
200 text/html                       ← la SPA, servida por nginx

$ curl http://localhost:8099/salud
{"ok":true}                         ← proxy al backend, por nombre de servicio

$ curl -o /dev/null -w "%{http_code}\n" http://localhost:8099/api/items
401                                 ← la sesión se sigue exigiendo

$ curl -o /dev/null -w "%{http_code}\n" http://localhost:8099/buscar
200                                 ← fallback de try_files: lo resuelve el router
```

### Tamaño de las imágenes

El multi-stage se paga acá: la etapa `deps` es la que trae typescript,
vitest, vite y drizzle-kit, y no viaja a la imagen final.

```console
$ docker images --format '{{.Repository}}\t{{.Size}}'
notia-api-deps (etapa intermedia)   552MB
notia-notia-api                     342MB     ← -38%
notia-notia-web                     92.1MB    ← nginx + estáticos, sin Node
```

### La suite

```console
$ pnpm test
 Test Files  9 passed (9)
      Tests  79 passed (79)

$ pnpm typecheck
(sin salida: limpio)
```
