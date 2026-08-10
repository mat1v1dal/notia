import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "./db.js";
import { ingest } from "./ingest.js";
import { chats, inbox } from "./schema.js";
import { makeTestDb } from "./testing.js";

const GRUPO = "bases@g.us";

let db: Db;

beforeEach(async () => {
  db = await makeTestDb();
});

function mensaje(over: Partial<Parameters<typeof ingest>[1]> = {}) {
  return {
    jid: GRUPO,
    nombre: "Bases de Datos II",
    esGrupo: true,
    waMessageId: "wa_1",
    autor: "Ana",
    body: "el TP3 se corre al viernes",
    sentAt: new Date("2026-08-10T17:03:00Z"),
    ...over,
  };
}

test("un chat desconocido queda registrado pero su mensaje no se guarda", async () => {
  const resultado = await ingest(db, mensaje());

  expect(resultado).toBe("ignorado");

  const [chat] = await db.select().from(chats);
  expect(chat!.jid).toBe(GRUPO);
  expect(chat!.nombre).toBe("Bases de Datos II");
  expect(chat!.tracked).toBe(false);

  expect(await db.select().from(inbox)).toHaveLength(0);
});

test("un mensaje de un chat trackeado se encola", async () => {
  await db.insert(chats).values({ jid: GRUPO, tracked: true });

  const resultado = await ingest(db, mensaje());

  expect(resultado).toBe("encolado");
  const [fila] = await db.select().from(inbox);
  expect(fila!.body).toBe("el TP3 se corre al viernes");
  expect(fila!.autor).toBe("Ana");
  expect(fila!.claimedAt).toBeNull();
});

test("un reintento con el mismo wa_message_id no duplica la fila", async () => {
  await db.insert(chats).values({ jid: GRUPO, tracked: true });

  await ingest(db, mensaje());
  const segundo = await ingest(db, mensaje());

  expect(segundo).toBe("duplicado");
  expect(await db.select().from(inbox)).toHaveLength(1);
});

test("pending_since marca el inicio de la tanda y no se pisa con los mensajes siguientes", async () => {
  await db.insert(chats).values({ jid: GRUPO, tracked: true });

  const primero = new Date("2026-08-10T17:00:00Z");
  const segundo = new Date("2026-08-10T17:04:00Z");

  await ingest(db, mensaje({ waMessageId: "wa_1" }), primero);
  await ingest(db, mensaje({ waMessageId: "wa_2" }), segundo);

  const [chat] = await db.select().from(chats).where(eq(chats.jid, GRUPO));
  expect(chat!.pendingSince?.toISOString()).toBe(primero.toISOString());
  expect(chat!.lastMessageAt?.toISOString()).toBe(segundo.toISOString());
});

test("un mensaje sin texto no se encola", async () => {
  await db.insert(chats).values({ jid: GRUPO, tracked: true });

  const resultado = await ingest(db, mensaje({ body: "   " }));

  expect(resultado).toBe("ignorado");
  expect(await db.select().from(inbox)).toHaveLength(0);
});

test("un chat ya conocido no pierde su estado tracked al llegar otro mensaje", async () => {
  await db.insert(chats).values({ jid: GRUPO, nombre: "viejo", tracked: true });

  await ingest(db, mensaje({ nombre: "Bases de Datos II" }));

  const [chat] = await db.select().from(chats);
  expect(chat!.tracked).toBe(true);
  expect(chat!.nombre).toBe("Bases de Datos II");
});
