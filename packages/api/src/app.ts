import type { Db } from "@notia/core";
import { ingest } from "@notia/core/ingest";
import {
  closeItem,
  createItem,
  reopenItem,
  searchItems,
  updateItem,
  type ItemPatch,
} from "@notia/core/items";
import { chats, itemChanges, items } from "@notia/core/schema";
import { undoToken, verifyUndoToken } from "@notia/core/undo";
import { desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { normalizeEvolutionMessage } from "./evolution.js";

export type AppConfig = {
  db: Db;
  /** Token que Evolution manda en el header `apikey` del webhook. */
  webhookToken: string;
  /** Contraseña única de la app. Un solo usuario, sin registro ni roles. */
  password: string;
  /** Secreto para firmar la cookie de sesión y los tokens de deshacer. */
  secret: string;
};

const COOKIE = "notia_sesion";

export function createApp(cfg: AppConfig) {
  const app = new Hono();
  const { db } = cfg;

  // ── webhook ───────────────────────────────────────────────────────────────
  // No autentica con la cookie: viene de Evolution, no del navegador.
  // Nunca llama al modelo: responde en milisegundos y el worker hace el resto.
  app.post("/webhook/whatsapp", async (c) => {
    if (c.req.header("apikey") !== cfg.webhookToken) {
      return c.json({ error: "no autorizado" }, 401);
    }

    const msg = normalizeEvolutionMessage(await c.req.json().catch(() => null));
    if (!msg) return c.json({ ok: true, resultado: "descartado" });

    const resultado = await ingest(db, msg);
    return c.json({ ok: true, resultado });
  });

  // ── sesión ────────────────────────────────────────────────────────────────
  app.post("/login", async (c) => {
    const { password } = await c.req.json().catch(() => ({ password: "" }));
    if (password !== cfg.password) return c.json({ error: "contraseña incorrecta" }, 401);

    setCookie(c, COOKIE, cfg.secret, {
      httpOnly: true,
      sameSite: "Lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return c.json({ ok: true });
  });

  app.use("/api/*", async (c, next) => {
    if (getCookie(c, COOKIE) !== cfg.secret) return c.json({ error: "no autorizado" }, 401);
    await next();
  });

  // ── items ─────────────────────────────────────────────────────────────────
  app.get("/api/items", async (c) => {
    const q = c.req.query("q");
    if (q) return c.json(await searchItems(db, q, {}));

    const abiertos = c.req.query("estado") !== "todos";
    const filas = await db
      .select()
      .from(items)
      .where(abiertos ? isNull(items.doneAt) : undefined)
      .orderBy(items.dueAt, desc(items.id));
    return c.json(filas);
  });

  app.post("/api/items", async (c) => {
    const body = await c.req.json();
    const item = await createItem(
      db,
      {
        content: String(body.content ?? "").trim(),
        url: body.url ?? null,
        dueAt: body.due_at ? new Date(body.due_at) : null,
        context: body.context ?? null,
        tags: body.tags ?? [],
        source: "web",
      },
      { jid: null, motivo: null },
    );
    return c.json(item, 201);
  });

  app.patch("/api/items/:id", async (c) => {
    const body = await c.req.json();
    const patch: ItemPatch = {
      ...(body.content !== undefined && { content: body.content }),
      ...(body.url !== undefined && { url: body.url }),
      ...(body.due_at !== undefined && { dueAt: body.due_at ? new Date(body.due_at) : null }),
      ...(body.context !== undefined && { context: body.context }),
      ...(body.tags !== undefined && { tags: body.tags }),
    };
    // Sin scope: el usuario desde la web alcanza cualquier item.
    const item = await updateItem(db, Number(c.req.param("id")), patch, { jid: null, motivo: null }, {});
    return item ? c.json(item) : c.json({ error: "no encontrado" }, 404);
  });

  app.post("/api/items/:id/cerrar", async (c) => {
    const item = await closeItem(db, Number(c.req.param("id")), { jid: null, motivo: null }, {});
    return item ? c.json(item) : c.json({ error: "no encontrado" }, 404);
  });

  app.post("/api/items/:id/reabrir", async (c) => {
    const item = await reopenItem(db, Number(c.req.param("id")), { jid: null, motivo: null }, {});
    return item ? c.json(item) : c.json({ error: "no encontrado" }, 404);
  });

  // ── chats ─────────────────────────────────────────────────────────────────
  app.get("/api/chats", async (c) => {
    const filas = await db.select().from(chats).orderBy(desc(chats.lastSeenAt));
    return c.json(filas);
  });

  app.patch("/api/chats/:jid", async (c) => {
    const { tracked } = await c.req.json();
    const [chat] = await db
      .update(chats)
      .set({ tracked: Boolean(tracked) })
      .where(eq(chats.jid, c.req.param("jid")))
      .returning();
    return chat ? c.json(chat) : c.json({ error: "no encontrado" }, 404);
  });

  // ── log ───────────────────────────────────────────────────────────────────
  app.get("/api/log", async (c) => {
    const filas = await db
      .select({ cambio: itemChanges, item: items })
      .from(itemChanges)
      .innerJoin(items, eq(itemChanges.itemId, items.id))
      .orderBy(desc(itemChanges.id))
      .limit(100);

    return c.json(
      filas.map(({ cambio, item }) => ({
        ...cambio,
        item,
        undo_token: undoToken(cambio.id, cfg.secret),
      })),
    );
  });

  // ── deshacer ──────────────────────────────────────────────────────────────
  // Sin cookie: el link llega por WhatsApp y tiene que funcionar de un tap.
  // Lo que autoriza es el token firmado, que solo vale para ese cambio.
  app.get("/u/:id/:token", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || !verifyUndoToken(id, c.req.param("token"), cfg.secret)) {
      return c.text("link inválido", 403);
    }

    const [cambio] = await db.select().from(itemChanges).where(eq(itemChanges.id, id));
    if (!cambio) return c.text("no encontrado", 404);
    if (cambio.undoneAt) return c.redirect(`/#/item/${cambio.itemId}?ya=1`);

    const antes = cambio.antes as Record<string, unknown> | null;

    await db.transaction(async (tx) => {
      if (cambio.accion === "crear") {
        // Un item creado por error se cierra, no se borra: cerrar es reversible.
        await tx.update(items).set({ doneAt: new Date() }).where(eq(items.id, cambio.itemId));
      } else if (antes) {
        await tx
          .update(items)
          .set({
            content: antes.content as string,
            url: (antes.url as string) ?? null,
            dueAt: antes.dueAt ? new Date(antes.dueAt as string) : null,
            doneAt: antes.doneAt ? new Date(antes.doneAt as string) : null,
            context: (antes.context as string) ?? null,
            tags: (antes.tags as string[]) ?? [],
            updatedAt: new Date(),
          })
          .where(eq(items.id, cambio.itemId));
      }

      await tx.update(itemChanges).set({ undoneAt: new Date() }).where(eq(itemChanges.id, id));
    });

    return c.redirect(`/#/item/${cambio.itemId}?deshecho=1`);
  });

  app.get("/salud", (c) => c.json({ ok: true }));

  return app;
}
