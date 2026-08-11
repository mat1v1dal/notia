import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { connect } from "@notia/core/connect";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

function requerido(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`falta la variable de entorno ${nombre}`);
  return valor;
}

const { db } = await connect(requerido("DATABASE_URL"));

const app = createApp({
  db,
  webhookToken: requerido("WEBHOOK_TOKEN"),
  password: requerido("APP_PASSWORD"),
  secret: requerido("APP_SECRET"),
});

// La PWA buildeada se sirve desde la misma API: un solo origen, sin CORS.
// serveStatic resuelve contra el directorio de trabajo, que no es el mismo
// en el contenedor (/app) que corriendo local (packages/api). Se calcula
// desde la ubicación del módulo para que ande en los dos casos.
const publico = relative(process.cwd(), fileURLToPath(new URL("../public", import.meta.url)));

app.use("/*", serveStatic({ root: publico }));
app.get("*", serveStatic({ path: `${publico}/index.html` }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`notia-api escuchando en :${port}`);
