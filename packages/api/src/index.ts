import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { connect } from "@notia/core/connect";
import { existsSync } from "node:fs";
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

// La PWA buildeada puede servirse desde la misma API (un solo origen, sin
// CORS) o desde su propio contenedor con nginx. serveStatic resuelve contra
// el directorio de trabajo, que no es el mismo en el contenedor (/app) que
// corriendo local (packages/api): se calcula desde la ubicación del módulo.
const publicoAbs = fileURLToPath(new URL("../public", import.meta.url));

// Si el build no está acá, es porque lo sirve nginx. Montar las rutas igual
// haría que la API respondiera 404 a todo lo que no matcheó antes, tapando
// el 404 real de la API con uno de estáticos.
if (existsSync(publicoAbs)) {
  const publico = relative(process.cwd(), publicoAbs);
  app.use("/*", serveStatic({ root: publico }));
  app.get("*", serveStatic({ path: `${publico}/index.html` }));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`notia-api escuchando en :${port}`);
