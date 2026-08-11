import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { connect } from "@notia/core/connect";
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
app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`notia-api escuchando en :${port}`);
