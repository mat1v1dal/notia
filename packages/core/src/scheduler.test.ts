import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "./db.js";
import { createItem, updateItem } from "./items.js";
import type { Notifier } from "./notifier.js";
import { runChangeDigest, runMorningDigest, runReminders } from "./scheduler.js";
import { chats, itemChanges, items } from "./schema.js";
import { makeTestDb } from "./testing.js";

const GRUPO = "bases@g.us";
const TZ = "America/Argentina/Buenos_Aires"; // UTC-3

let db: Db;
let enviados: string[];
let notifier: Notifier;

beforeEach(async () => {
  db = await makeTestDb();
  await db.insert(chats).values({ jid: GRUPO, nombre: "Bases de Datos II", tracked: true });
  enviados = [];
  notifier = { async send(text) { enviados.push(text); } };
});

const opts = (over: Record<string, unknown> = {}) => ({ timezone: TZ, ...over });

async function item(content: string, dueAt: Date | null) {
  return createItem(
    db,
    { content, dueAt, source: "whatsapp", sourceJid: GRUPO },
    { jid: GRUPO, motivo: null },
  );
}

// ── aviso puntual ───────────────────────────────────────────────────────────

test("avisa un item cuando entra en la ventana de lead y lo marca notificado", async () => {
  const it = await item("entregar TP3", new Date("2026-08-18T21:00:00Z"));

  // lead por defecto 60 min: a las 20:05Z ya está dentro
  const enviadas = await runReminders(db, notifier, opts({ now: new Date("2026-08-18T20:05:00Z") }));

  expect(enviadas).toBe(1);
  expect(enviados[0]).toContain("entregar TP3");

  const [guardado] = await db.select().from(items).where(eq(items.id, it.id));
  expect(guardado!.notifiedAt).toBeInstanceOf(Date);
});

test("no avisa antes de que el item entre en la ventana de lead", async () => {
  await item("entregar TP3", new Date("2026-08-18T21:00:00Z"));

  const enviadas = await runReminders(db, notifier, opts({ now: new Date("2026-08-18T19:00:00Z") }));

  expect(enviadas).toBe(0);
  expect(enviados).toHaveLength(0);
});

test("no avisa dos veces el mismo item", async () => {
  await item("entregar TP3", new Date("2026-08-18T21:00:00Z"));
  const now = new Date("2026-08-18T20:05:00Z");

  await runReminders(db, notifier, opts({ now }));
  const segunda = await runReminders(db, notifier, opts({ now }));

  expect(segunda).toBe(0);
  expect(enviados).toHaveLength(1);
});

test("no avisa items ya cerrados ni items sin fecha", async () => {
  const cerrado = await item("ya entregado", new Date("2026-08-18T21:00:00Z"));
  await db.update(items).set({ doneAt: new Date() }).where(eq(items.id, cerrado.id));
  await item("nota sin fecha", null);

  const enviadas = await runReminders(db, notifier, opts({ now: new Date("2026-08-18T20:05:00Z") }));

  expect(enviadas).toBe(0);
});

test("un item con fecha pero sin hora no dispara aviso puntual: queda para el digest", async () => {
  // 2026-08-18 00:00 en Buenos Aires = 03:00Z
  await item("entregar TP3", new Date("2026-08-18T03:00:00Z"));

  const enviadas = await runReminders(db, notifier, opts({ now: new Date("2026-08-18T02:30:00Z") }));

  expect(enviadas).toBe(0);
});

// ── digest matinal ──────────────────────────────────────────────────────────

test("el digest matinal lista lo que vence hoy en la zona del usuario", async () => {
  await item("entregar TP3", new Date("2026-08-18T21:00:00Z")); // 18/8 18:00 local
  await item("parcial de sistemas", new Date("2026-08-19T14:00:00Z")); // mañana

  // 08:00 local del 18/8 = 11:00Z
  const mando = await runMorningDigest(db, notifier, opts({ now: new Date("2026-08-18T11:00:00Z") }));

  expect(mando).toBe(true);
  expect(enviados[0]).toContain("entregar TP3");
  expect(enviados[0]).not.toContain("parcial de sistemas");
});

test("el digest matinal no se manda dos veces el mismo día", async () => {
  await item("entregar TP3", new Date("2026-08-18T21:00:00Z"));

  await runMorningDigest(db, notifier, opts({ now: new Date("2026-08-18T11:00:00Z") }));
  const segunda = await runMorningDigest(db, notifier, opts({ now: new Date("2026-08-18T11:30:00Z") }));

  expect(segunda).toBe(false);
  expect(enviados).toHaveLength(1);
});

test("el digest matinal no corre fuera de su hora", async () => {
  await item("entregar TP3", new Date("2026-08-18T21:00:00Z"));

  const mando = await runMorningDigest(db, notifier, opts({ now: new Date("2026-08-18T15:00:00Z") }));

  expect(mando).toBe(false);
});

test("el digest matinal marca notificados solo los items sin hora", async () => {
  const sinHora = await item("entregar TP3", new Date("2026-08-18T03:00:00Z")); // 00:00 local
  const conHora = await item("reunión", new Date("2026-08-18T21:00:00Z")); // 18:00 local

  await runMorningDigest(db, notifier, opts({ now: new Date("2026-08-18T11:00:00Z") }));

  const [a] = await db.select().from(items).where(eq(items.id, sinHora.id));
  const [b] = await db.select().from(items).where(eq(items.id, conHora.id));
  expect(a!.notifiedAt).toBeInstanceOf(Date);
  expect(b!.notifiedAt).toBeNull();
});

// ── avisos de cambios del agente ────────────────────────────────────────────

test("agrupa los cambios sin notificar en un solo mensaje", async () => {
  const it = await item("entregar TP3", new Date("2026-08-13T21:00:00Z"));
  await updateItem(
    db,
    it.id,
    { dueAt: new Date("2026-08-18T21:00:00Z") },
    { jid: GRUPO, motivo: "Ana avisó que se corre al viernes 18" },
    { scopeJid: GRUPO },
  );

  const cantidad = await runChangeDigest(db, notifier, opts({ now: new Date("2026-08-13T22:00:00Z") }));

  expect(cantidad).toBe(2); // la creación y la edición
  expect(enviados).toHaveLength(1);
  expect(enviados[0]).toContain("Bases de Datos II");
  expect(enviados[0]).toContain("Ana avisó que se corre al viernes 18");
});

test("no manda nada si no hay cambios pendientes", async () => {
  const cantidad = await runChangeDigest(db, notifier, opts({ now: new Date() }));

  expect(cantidad).toBe(0);
  expect(enviados).toHaveLength(0);
});

test("no re-manda cambios ya notificados", async () => {
  await item("entregar TP3", null);

  await runChangeDigest(db, notifier, opts({ now: new Date() }));
  const segunda = await runChangeDigest(db, notifier, opts({ now: new Date() }));

  expect(segunda).toBe(0);
  expect(enviados).toHaveLength(1);
});

test("los cambios hechos por el usuario desde la web no se avisan", async () => {
  await createItem(db, { content: "nota de la web", source: "web" }, { jid: null, motivo: null });

  const cantidad = await runChangeDigest(db, notifier, opts({ now: new Date() }));

  expect(cantidad).toBe(0);
});

test("el mensaje de cambios incluye el link para deshacer", async () => {
  await item("entregar TP3", null);

  await runChangeDigest(
    db,
    notifier,
    opts({ now: new Date(), undoLink: (id: number) => `https://notia.test/u/tok${id}` }),
  );

  const [cambio] = await db.select().from(itemChanges);
  expect(enviados[0]).toContain(`https://notia.test/u/tok${cambio!.id}`);
});
