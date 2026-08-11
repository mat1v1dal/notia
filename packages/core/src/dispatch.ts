import { and, eq, inArray, isNotNull, isNull, lt, lte, min, or } from "drizzle-orm";
import { applyToolCall, buildInstructions, type ToolCall, type ToolOutput } from "./agent.js";
import type { Db } from "./db.js";
import { chats, inbox, type Chat, type InboxRow } from "./schema.js";

/** Un turno del modelo: o pide herramientas, o terminó. */
export type ModelTurn =
  | { kind: "tool_calls"; responseId: string; conversationId: string; calls: ToolCall[] }
  | { kind: "done"; responseId: string; conversationId: string; text: string };

/**
 * Lo único que el despachador delega hacia afuera: hablar con el modelo.
 * El loop, la aplicación de tool calls y el manejo de la cola quedan de
 * este lado, donde se pueden testear sin red.
 */
export type ModelClient = {
  start(args: {
    conversationId: string | null;
    instructions: string;
    input: string;
    /** Se adjunta a la conversación cuando hay que crearla, para poder
     * reconstruir el mapeo chat ↔ conversación desde el lado de OpenAI. */
    conversationMetadata?: Record<string, string>;
  }): Promise<ModelTurn>;

  submitToolOutputs(args: {
    conversationId: string;
    previousResponseId: string;
    instructions: string;
    outputs: ToolOutput[];
  }): Promise<ModelTurn>;
};

export type DispatchOptions = {
  now?: Date;
  /** Silencio que tiene que tener el chat para procesar la tanda. */
  silenceMs?: number;
  /** Tope: se despacha igual aunque la ráfaga no pare. */
  maxWaitMs?: number;
  /** Reintentos antes de dar el chat por trabado. */
  maxAttempts?: number;
  timezone?: string;
  /** Corte de seguridad contra un modelo que pida herramientas sin parar. */
  maxToolRounds?: number;
};

const DEFAULTS = {
  silenceMs: 3 * 60_000,
  maxWaitMs: 15 * 60_000,
  maxAttempts: 5,
  timezone: "America/Argentina/Buenos_Aires",
  maxToolRounds: 8,
};

/**
 * Procesa las tandas que ya están listas.
 *
 * Devuelve cuántos chats se despacharon con éxito.
 */
export async function dispatchDueChats(
  db: Db,
  model: ModelClient,
  opts: DispatchOptions = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const o = { ...DEFAULTS, ...opts };

  const candidatos = await db
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.tracked, true),
        isNotNull(chats.pendingSince),
        lt(chats.agentAttempts, o.maxAttempts),
        or(
          lte(chats.lastMessageAt, new Date(now.getTime() - o.silenceMs)),
          lte(chats.pendingSince, new Date(now.getTime() - o.maxWaitMs)),
        ),
      ),
    );

  let despachados = 0;
  for (const chat of candidatos) {
    if (await dispatchChat(db, model, chat, now, o)) despachados++;
  }
  return despachados;
}

async function dispatchChat(
  db: Db,
  model: ModelClient,
  chat: Chat,
  now: Date,
  o: Required<Omit<DispatchOptions, "now">>,
): Promise<boolean> {
  // Reclamo atómico: si otro worker llegó primero, esto vuelve vacío.
  const reclamados: InboxRow[] = await db
    .update(inbox)
    .set({ claimedAt: now })
    .where(and(eq(inbox.jid, chat.jid), isNull(inbox.claimedAt)))
    .returning();

  if (reclamados.length === 0) {
    await rearmPending(db, chat.jid);
    return false;
  }

  const ordenados = [...reclamados].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const input = ordenados.map((m) => `[${m.autor ?? "?"}] ${m.body}`).join("\n");
  const instructions = await buildInstructions(db, chat.jid, now, o.timezone);
  const ids = ordenados.map((m) => m.id);

  try {
    let turn = await model.start({
      conversationId: chat.conversationId,
      instructions,
      input,
      conversationMetadata: { wa_jid: chat.jid },
    });

    let rondas = 0;
    while (turn.kind === "tool_calls") {
      if (++rondas > o.maxToolRounds) {
        throw new Error(`el modelo superó ${o.maxToolRounds} rondas de herramientas`);
      }
      const outputs: ToolOutput[] = [];
      for (const call of turn.calls) {
        outputs.push(
          await applyToolCall(db, { jid: chat.jid, responseId: turn.responseId }, call),
        );
      }
      turn = await model.submitToolOutputs({
        conversationId: turn.conversationId,
        previousResponseId: turn.responseId,
        instructions,
        outputs,
      });
    }

    await db.transaction(async (tx) => {
      await tx.delete(inbox).where(inArray(inbox.id, ids));
      // Los mensajes que entraron mientras corría el turno no se pierden:
      // pending_since se re-arma con el más viejo que haya quedado.
      const [pendiente] = await tx
        .select({ desde: min(inbox.sentAt) })
        .from(inbox)
        .where(eq(inbox.jid, chat.jid));

      await tx
        .update(chats)
        .set({
          conversationId: turn.conversationId,
          agentAttempts: 0,
          pendingSince: pendiente?.desde ?? null,
        })
        .where(eq(chats.jid, chat.jid));
    });

    return true;
  } catch {
    // La tanda vuelve a la cola entera; el turno es atómico o no fue.
    await db.update(inbox).set({ claimedAt: null }).where(inArray(inbox.id, ids));
    await db
      .update(chats)
      .set({ agentAttempts: chat.agentAttempts + 1 })
      .where(eq(chats.jid, chat.jid));
    return false;
  }
}

/** Deja `pending_since` acorde a lo que realmente quedó en la cola. */
async function rearmPending(db: Db, jid: string): Promise<void> {
  const [pendiente] = await db
    .select({ desde: min(inbox.sentAt) })
    .from(inbox)
    .where(and(eq(inbox.jid, jid), isNull(inbox.claimedAt)));

  await db
    .update(chats)
    .set({ pendingSince: pendiente?.desde ?? null })
    .where(eq(chats.jid, jid));
}
