import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "./db.js";
import { dispatchDueChats, type ModelClient, type ModelTurn } from "./dispatch.js";
import { createItem } from "./items.js";
import { ingest } from "./ingest.js";
import { chats, inbox, items } from "./schema.js";
import { makeTestDb } from "./testing.js";

const GRUPO = "bases@g.us";
const T0 = new Date("2026-08-10T17:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

let db: Db;

beforeEach(async () => {
  db = await makeTestDb();
  await db.insert(chats).values({ jid: GRUPO, nombre: "Bases de Datos II", tracked: true });
});

async function llega(waMessageId: string, body: string, at: Date) {
  await ingest(
    db,
    { jid: GRUPO, esGrupo: true, waMessageId, autor: "Ana", body, sentAt: at },
    at,
  );
}

/** Modelo falso que responde una secuencia guionada de turnos. */
function modeloQueResponde(...turnos: ModelTurn[]): ModelClient & { inputs: string[] } {
  const restantes = [...turnos];
  const inputs: string[] = [];
  const siguiente = (): ModelTurn => {
    const t = restantes.shift();
    if (!t) throw new Error("el test pidió más turnos de los guionados");
    return t;
  };
  return {
    inputs,
    async start(args) {
      inputs.push(args.input);
      return siguiente();
    },
    async submitToolOutputs() {
      return siguiente();
    },
  };
}

const listo = (over: Partial<Extract<ModelTurn, { kind: "done" }>> = {}): ModelTurn => ({
  kind: "done",
  responseId: "resp_1",
  conversationId: "conv_1",
  text: "",
  ...over,
});

test("no despacha mientras la ráfaga sigue viva", async () => {
  await llega("wa_1", "che chicos", min(0));
  await llega("wa_2", "hablaron con el profe?", min(1));

  const modelo = modeloQueResponde();
  const despachados = await dispatchDueChats(db, modelo, { now: min(2) });

  expect(despachados).toBe(0);
  expect(await db.select().from(inbox)).toHaveLength(2);
});

test("despacha cuando el chat lleva 3 minutos en silencio", async () => {
  await llega("wa_1", "el TP3 se corre al viernes", min(0));

  const modelo = modeloQueResponde(listo());
  const despachados = await dispatchDueChats(db, modelo, { now: min(4) });

  expect(despachados).toBe(1);
  expect(modelo.inputs[0]).toContain("el TP3 se corre al viernes");
});

test("despacha por el tope de 15 minutos aunque la ráfaga no pare", async () => {
  await llega("wa_1", "primero", min(0));
  await llega("wa_2", "sigue hablando", min(14));

  const modelo = modeloQueResponde(listo());
  const despachados = await dispatchDueChats(db, modelo, { now: min(16) });

  expect(despachados).toBe(1);
});

test("la tanda le llega al modelo como un solo turno con autor y orden", async () => {
  await llega("wa_1", "che chicos", min(0));
  await llega("wa_2", "el TP3 se corre", min(1));

  const modelo = modeloQueResponde(listo());
  await dispatchDueChats(db, modelo, { now: min(5) });

  expect(modelo.inputs).toHaveLength(1);
  expect(modelo.inputs[0]).toBe("[Ana] che chicos\n[Ana] el TP3 se corre");
});

test("aplica los tool calls del modelo y cierra el turno", async () => {
  await llega("wa_1", "el TP3 es el viernes 18", min(0));

  const modelo = modeloQueResponde(
    {
      kind: "tool_calls",
      responseId: "resp_1",
      conversationId: "conv_1",
      calls: [
        {
          callId: "c1",
          name: "crear_item",
          argumentsJson: JSON.stringify({
            content: "entregar TP3",
            motivo: "Ana avisó la fecha",
            due_at: "2026-08-18T21:00:00.000Z",
          }),
        },
      ],
    },
    listo({ responseId: "resp_2" }),
  );

  await dispatchDueChats(db, modelo, { now: min(5) });

  const [creado] = await db.select().from(items);
  expect(creado!.content).toBe("entregar TP3");
  expect(creado!.sourceJid).toBe(GRUPO);
});

test("al terminar vacía la cola y deja el chat sin pendientes", async () => {
  await llega("wa_1", "algo", min(0));

  await dispatchDueChats(db, modeloQueResponde(listo()), { now: min(5) });

  expect(await db.select().from(inbox)).toHaveLength(0);
  const [chat] = await db.select().from(chats).where(eq(chats.jid, GRUPO));
  expect(chat!.pendingSince).toBeNull();
  expect(chat!.agentAttempts).toBe(0);
});

test("los mensajes que entran durante el turno quedan pendientes para el siguiente", async () => {
  await llega("wa_1", "primero", min(0));

  // El modelo tarda, y mientras tanto llega otro mensaje al mismo chat.
  const modelo: ModelClient = {
    async start() {
      await llega("wa_2", "llegó tarde", min(5));
      return listo();
    },
    async submitToolOutputs() {
      throw new Error("no debería llamarse");
    },
  };

  await dispatchDueChats(db, modelo, { now: min(5) });

  const restante = await db.select().from(inbox);
  expect(restante).toHaveLength(1);
  expect(restante[0]!.body).toBe("llegó tarde");

  const [chat] = await db.select().from(chats).where(eq(chats.jid, GRUPO));
  expect(chat!.pendingSince).not.toBeNull();
});

test("guarda el conversation_id que devuelve el modelo en el primer turno", async () => {
  await llega("wa_1", "algo", min(0));

  await dispatchDueChats(db, modeloQueResponde(listo({ conversationId: "conv_nuevo" })), {
    now: min(5),
  });

  const [chat] = await db.select().from(chats).where(eq(chats.jid, GRUPO));
  expect(chat!.conversationId).toBe("conv_nuevo");
});

test("si el modelo falla, la tanda queda intacta y se cuenta el intento", async () => {
  await llega("wa_1", "algo", min(0));

  const modelo: ModelClient = {
    async start() {
      throw new Error("503 del proveedor");
    },
    async submitToolOutputs() {
      throw new Error("no debería llamarse");
    },
  };

  const despachados = await dispatchDueChats(db, modelo, { now: min(5) });

  expect(despachados).toBe(0);
  const [fila] = await db.select().from(inbox);
  expect(fila!.claimedAt).toBeNull();

  const [chat] = await db.select().from(chats).where(eq(chats.jid, GRUPO));
  expect(chat!.agentAttempts).toBe(1);
  expect(chat!.pendingSince).not.toBeNull();
});

test("un chat que agotó los reintentos deja de despacharse", async () => {
  await llega("wa_1", "algo", min(0));
  await db.update(chats).set({ agentAttempts: 5 }).where(eq(chats.jid, GRUPO));

  const despachados = await dispatchDueChats(db, modeloQueResponde(), { now: min(5) });

  expect(despachados).toBe(0);
  // Si se hubiera intentado despachar, el fallo del modelo lo habría subido a 6.
  const [chat] = await db.select().from(chats).where(eq(chats.jid, GRUPO));
  expect(chat!.agentAttempts).toBe(5);
  expect((await db.select().from(inbox))[0]!.claimedAt).toBeNull();
});

test("las instructions llevan el snapshot de items abiertos, la zona horaria y el ahora", async () => {
  await createItem(
    db,
    { content: "leer paper de Raft", source: "whatsapp", sourceJid: GRUPO },
    { jid: GRUPO, motivo: null },
  );
  await llega("wa_1", "algo", min(0));

  let recibidas = "";
  const modelo: ModelClient = {
    async start(args) {
      recibidas = args.instructions;
      return listo();
    },
    async submitToolOutputs() {
      throw new Error("no debería llamarse");
    },
  };

  await dispatchDueChats(db, modelo, { now: min(5), timezone: "America/Argentina/Buenos_Aires" });

  expect(recibidas).toContain("leer paper de Raft");
  expect(recibidas).toContain("America/Argentina/Buenos_Aires");
  expect(recibidas).toContain(min(5).toISOString());
});
