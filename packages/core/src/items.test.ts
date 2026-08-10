import { beforeEach, expect, test } from "vitest";
import {
  closeItem,
  createItem,
  openItemsForChat,
  reopenItem,
  searchItems,
  updateItem,
} from "./items.js";
import { chats, itemChanges, items } from "./schema.js";
import { makeTestDb } from "./testing.js";
import type { Db } from "./db.js";

const GRUPO = "bases@g.us";
const OTRO_GRUPO = "backend@g.us";

let db: Db;

beforeEach(async () => {
  db = await makeTestDb();
  await db.insert(chats).values([
    { jid: GRUPO, nombre: "Bases de Datos II", tracked: true },
    { jid: OTRO_GRUPO, nombre: "Equipo Backend", tracked: true },
  ]);
});

test("createItem persiste el item", async () => {
  const item = await createItem(
    db,
    {
      content: "entregar TP3 de bases",
      dueAt: new Date("2026-08-14T21:00:00Z"),
      source: "whatsapp",
      sourceJid: GRUPO,
    },
    { jid: GRUPO, motivo: "Ana avisó la fecha en el grupo", responseId: "resp_1" },
  );

  const stored = await db.select().from(items);
  expect(stored).toHaveLength(1);
  expect(stored[0]!.id).toBe(item.id);
  expect(stored[0]!.content).toBe("entregar TP3 de bases");
  expect(stored[0]!.sourceJid).toBe(GRUPO);
  expect(stored[0]!.doneAt).toBeNull();
});

test("createItem registra la creación en el log con su motivo", async () => {
  await createItem(
    db,
    { content: "entregar TP3 de bases", source: "whatsapp", sourceJid: GRUPO },
    { jid: GRUPO, motivo: "Ana avisó la fecha en el grupo", responseId: "resp_1" },
  );

  const log = await db.select().from(itemChanges);
  expect(log).toHaveLength(1);
  expect(log[0]!.accion).toBe("crear");
  expect(log[0]!.motivo).toBe("Ana avisó la fecha en el grupo");
  expect(log[0]!.responseId).toBe("resp_1");
  expect(log[0]!.jid).toBe(GRUPO);
  expect(log[0]!.antes).toBeNull();
});

test("updateItem aplica los cambios y registra el antes y el después", async () => {
  const item = await createItem(
    db,
    { content: "entregar TP3", dueAt: new Date("2026-08-13T21:00:00Z"), source: "whatsapp", sourceJid: GRUPO },
    { jid: GRUPO, motivo: null },
  );

  const nuevaFecha = new Date("2026-08-18T21:00:00Z");
  const updated = await updateItem(
    db,
    item.id,
    { dueAt: nuevaFecha },
    { jid: GRUPO, motivo: "Ana avisó que se corre al viernes 18", responseId: "resp_2" },
    { scopeJid: GRUPO },
  );

  expect(updated?.dueAt?.toISOString()).toBe(nuevaFecha.toISOString());

  const log = await db.select().from(itemChanges);
  const edicion = log.find((c) => c.accion === "editar");
  expect(edicion).toBeDefined();
  expect(edicion!.motivo).toBe("Ana avisó que se corre al viernes 18");
  expect((edicion!.antes as { dueAt: string }).dueAt).toBe("2026-08-13T21:00:00.000Z");
  expect((edicion!.despues as { dueAt: string }).dueAt).toBe("2026-08-18T21:00:00.000Z");
});

test("updateItem no toca un item que nació en otro chat", async () => {
  const item = await createItem(
    db,
    { content: "revisar PR de auth", source: "whatsapp", sourceJid: OTRO_GRUPO },
    { jid: OTRO_GRUPO, motivo: null },
  );

  const resultado = await updateItem(
    db,
    item.id,
    { content: "borrado por el grupo de la facultad" },
    { jid: GRUPO, motivo: "alguien lo pidió en el grupo equivocado" },
    { scopeJid: GRUPO },
  );

  expect(resultado).toBeNull();

  const [sinTocar] = await db.select().from(items);
  expect(sinTocar!.content).toBe("revisar PR de auth");

  const ediciones = (await db.select().from(itemChanges)).filter((c) => c.accion === "editar");
  expect(ediciones).toHaveLength(0);
});

test("updateItem sin scope alcanza items creados desde la web", async () => {
  const item = await createItem(db, { content: "nota suelta", source: "web" }, { jid: null, motivo: null });

  const updated = await updateItem(db, item.id, { content: "nota editada" }, { jid: null, motivo: null }, {});

  expect(updated?.content).toBe("nota editada");
});

test("closeItem marca el item como cerrado y lo registra", async () => {
  const item = await createItem(
    db,
    { content: "entregar TP3", source: "whatsapp", sourceJid: GRUPO },
    { jid: GRUPO, motivo: null },
  );

  const cerrado = await closeItem(
    db,
    item.id,
    { jid: GRUPO, motivo: "Juan dijo que ya lo entregaron" },
    { scopeJid: GRUPO },
  );

  expect(cerrado?.doneAt).toBeInstanceOf(Date);

  const cierre = (await db.select().from(itemChanges)).find((c) => c.accion === "cerrar");
  expect(cierre).toBeDefined();
  expect(cierre!.motivo).toBe("Juan dijo que ya lo entregaron");
});

test("closeItem no alcanza un item de otro chat", async () => {
  const item = await createItem(
    db,
    { content: "revisar PR de auth", source: "whatsapp", sourceJid: OTRO_GRUPO },
    { jid: OTRO_GRUPO, motivo: null },
  );

  const resultado = await closeItem(db, item.id, { jid: GRUPO, motivo: "x" }, { scopeJid: GRUPO });

  expect(resultado).toBeNull();
  const [sinTocar] = await db.select().from(items);
  expect(sinTocar!.doneAt).toBeNull();
});

test("reopenItem vuelve a abrir un item cerrado y lo registra", async () => {
  const item = await createItem(
    db,
    { content: "entregar TP3", source: "whatsapp", sourceJid: GRUPO },
    { jid: GRUPO, motivo: null },
  );
  await closeItem(db, item.id, { jid: GRUPO, motivo: "cerrado por error" }, { scopeJid: GRUPO });

  const reabierto = await reopenItem(db, item.id, { jid: null, motivo: "deshacer" }, {});

  expect(reabierto?.doneAt).toBeNull();
  const reapertura = (await db.select().from(itemChanges)).find((c) => c.accion === "reabrir");
  expect(reapertura).toBeDefined();
});

test("openItemsForChat devuelve solo los items abiertos de ese chat", async () => {
  const abierto = await createItem(
    db,
    { content: "entregar TP3", source: "whatsapp", sourceJid: GRUPO },
    { jid: GRUPO, motivo: null },
  );
  const cerrado = await createItem(
    db,
    { content: "leer paper de Raft", source: "whatsapp", sourceJid: GRUPO },
    { jid: GRUPO, motivo: null },
  );
  await closeItem(db, cerrado.id, { jid: GRUPO, motivo: null }, { scopeJid: GRUPO });
  await createItem(
    db,
    { content: "revisar PR de auth", source: "whatsapp", sourceJid: OTRO_GRUPO },
    { jid: OTRO_GRUPO, motivo: null },
  );
  await createItem(db, { content: "nota de la web", source: "web" }, { jid: null, motivo: null });

  const abiertos = await openItemsForChat(db, GRUPO);

  expect(abiertos.map((i) => i.id)).toEqual([abierto.id]);
});

test("searchItems no encuentra items fuera del alcance del chat", async () => {
  await createItem(
    db,
    { content: "revisar PR de auth", source: "whatsapp", sourceJid: OTRO_GRUPO },
    { jid: OTRO_GRUPO, motivo: null },
  );

  const desdeElGrupoEquivocado = await searchItems(db, "auth", { scopeJid: GRUPO });
  expect(desdeElGrupoEquivocado).toHaveLength(0);

  const desdeSuPropioChat = await searchItems(db, "auth", { scopeJid: OTRO_GRUPO });
  expect(desdeSuPropioChat).toHaveLength(1);
});

test("searchItems matchea sin distinguir mayúsculas", async () => {
  await createItem(
    db,
    { content: "Entregar TP3 de Bases", source: "whatsapp", sourceJid: GRUPO },
    { jid: GRUPO, motivo: null },
  );

  const encontrados = await searchItems(db, "tp3", { scopeJid: GRUPO });
  expect(encontrados).toHaveLength(1);
});
