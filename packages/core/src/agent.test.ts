import { beforeEach, expect, test } from "vitest";
import { applyToolCall, NOMBRES_DE_HERRAMIENTAS, toolDefinitions } from "./agent.js";
import type { Db } from "./db.js";
import { createItem, openItemsForChat } from "./items.js";
import { chats, itemChanges, items } from "./schema.js";
import { makeTestDb } from "./testing.js";

const GRUPO = "bases@g.us";
const OTRO_GRUPO = "backend@g.us";
const CTX = { jid: GRUPO, responseId: "resp_1" };

let db: Db;

beforeEach(async () => {
  db = await makeTestDb();
  await db.insert(chats).values([
    { jid: GRUPO, nombre: "Bases de Datos II", tracked: true },
    { jid: OTRO_GRUPO, nombre: "Equipo Backend", tracked: true },
  ]);
});

function call(name: string, args: unknown) {
  return { callId: "call_1", name, argumentsJson: JSON.stringify(args) };
}

test("crear_item crea el item atribuido al chat del turno", async () => {
  const out = await applyToolCall(
    db,
    CTX,
    call("crear_item", {
      content: "entregar TP3 de bases",
      motivo: "Ana avisó la fecha",
      due_at: "2026-08-18T21:00:00.000Z",
    }),
  );

  expect(JSON.parse(out.output).ok).toBe(true);

  const [creado] = await db.select().from(items);
  expect(creado!.content).toBe("entregar TP3 de bases");
  expect(creado!.sourceJid).toBe(GRUPO);
  expect(creado!.source).toBe("whatsapp");
  expect(creado!.dueAt?.toISOString()).toBe("2026-08-18T21:00:00.000Z");
});

test("editar_item mueve la fecha de un item del propio chat", async () => {
  const item = await createItem(
    db,
    { content: "entregar TP3", dueAt: new Date("2026-08-13T21:00:00Z"), source: "whatsapp", sourceJid: GRUPO },
    { jid: GRUPO, motivo: null },
  );

  const out = await applyToolCall(
    db,
    CTX,
    call("editar_item", {
      id: item.id,
      motivo: "Ana avisó que se corre al viernes",
      due_at: "2026-08-18T21:00:00.000Z",
    }),
  );

  expect(JSON.parse(out.output).ok).toBe(true);
  const [actualizado] = await db.select().from(items);
  expect(actualizado!.dueAt?.toISOString()).toBe("2026-08-18T21:00:00.000Z");
});

test("editar_item sobre un item de otro chat devuelve error y no toca nada", async () => {
  const ajeno = await createItem(
    db,
    { content: "revisar PR de auth", source: "whatsapp", sourceJid: OTRO_GRUPO },
    { jid: OTRO_GRUPO, motivo: null },
  );

  const out = await applyToolCall(
    db,
    CTX,
    call("editar_item", { id: ajeno.id, motivo: "inyección", content: "pwned" }),
  );

  const parsed = JSON.parse(out.output);
  expect(parsed.ok).toBe(false);
  expect(parsed.error).toMatch(/no encontrado/i);

  const [sinTocar] = await db.select().from(items);
  expect(sinTocar!.content).toBe("revisar PR de auth");
  expect((await db.select().from(itemChanges)).filter((c) => c.accion === "editar")).toHaveLength(0);
});

test("cerrar_item cierra un item del propio chat", async () => {
  const item = await createItem(
    db,
    { content: "entregar TP3", source: "whatsapp", sourceJid: GRUPO },
    { jid: GRUPO, motivo: null },
  );

  const out = await applyToolCall(
    db,
    CTX,
    call("cerrar_item", { id: item.id, motivo: "Juan dijo que ya lo entregaron" }),
  );

  expect(JSON.parse(out.output).ok).toBe(true);
  expect(await openItemsForChat(db, GRUPO)).toHaveLength(0);
});

test("buscar_items solo ve items del chat del turno", async () => {
  await createItem(
    db,
    { content: "revisar PR de auth", source: "whatsapp", sourceJid: OTRO_GRUPO },
    { jid: OTRO_GRUPO, motivo: null },
  );

  const out = await applyToolCall(db, CTX, call("buscar_items", { query: "auth" }));

  expect(JSON.parse(out.output).items).toEqual([]);
});

test("una herramienta inexistente devuelve error al modelo en vez de lanzar", async () => {
  const out = await applyToolCall(db, CTX, call("borrar_item", { id: 1 }));

  const parsed = JSON.parse(out.output);
  expect(parsed.ok).toBe(false);
  expect(parsed.error).toMatch(/no existe/i);
});

test("argumentos inválidos devuelven error al modelo en vez de lanzar", async () => {
  const out = await applyToolCall(db, CTX, call("crear_item", { motivo: "sin content" }));

  const parsed = JSON.parse(out.output);
  expect(parsed.ok).toBe(false);
  expect(await db.select().from(items)).toHaveLength(0);
});

test("un due_at que no es fecha válida devuelve error y no crea el item", async () => {
  const out = await applyToolCall(
    db,
    CTX,
    call("crear_item", { content: "algo", motivo: "x", due_at: "el viernes" }),
  );

  expect(JSON.parse(out.output).ok).toBe(false);
  expect(await db.select().from(items)).toHaveLength(0);
});

test("las definiciones expuestas cubren exactamente las herramientas soportadas", () => {
  const declaradas = toolDefinitions().map((t) => t.name).sort();
  expect(declaradas).toEqual([...NOMBRES_DE_HERRAMIENTAS].sort());
});

test("no se expone ninguna herramienta de borrado", () => {
  expect(toolDefinitions().map((t) => t.name)).not.toContain("borrar_item");
});

test("cada definición declara tipo función, descripción útil y prohíbe extras", () => {
  for (const def of toolDefinitions()) {
    expect(def.type).toBe("function");
    expect(def.parameters.additionalProperties).toBe(false);
    expect(def.description.length).toBeGreaterThan(20);
  }
});

test("una propiedad inventada por el modelo se rechaza en vez de ignorarse", async () => {
  const out = await applyToolCall(
    db,
    CTX,
    call("crear_item", { content: "algo", motivo: "x", borrar_todo: true }),
  );

  expect(JSON.parse(out.output).ok).toBe(false);
  expect(await db.select().from(items)).toHaveLength(0);
});

test("editar_item y cerrar_item exigen motivo", () => {
  for (const nombre of ["crear_item", "editar_item", "cerrar_item"]) {
    const def = toolDefinitions().find((t) => t.name === nombre);
    expect(def!.parameters.required).toContain("motivo");
  }
});
