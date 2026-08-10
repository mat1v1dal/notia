import { sql } from "drizzle-orm";
import type { Db } from "./db.js";
import { chats, inbox } from "./schema.js";

/** Un mensaje entrante ya normalizado desde el webhook de Evolution. */
export type IncomingMessage = {
  jid: string;
  nombre?: string | null;
  esGrupo: boolean;
  waMessageId: string;
  autor?: string | null;
  body: string;
  sentAt: Date;
};

export type IngestResult =
  /** El chat no se observa, o el mensaje no tenía texto. No se persistió nada. */
  | "ignorado"
  /** Quedó en la cola esperando su turno. */
  | "encolado"
  /** Reintento de Evolution: ya estaba encolado. */
  | "duplicado";

/**
 * Punto de entrada de todo mensaje de WhatsApp.
 *
 * El chat se registra siempre —así la web puede listarlo para elegir si
 * observarlo—, pero **el texto solo se persiste si el chat está trackeado**.
 * De los chats que no se observan no queda contenido en ningún lado.
 *
 * No llama al modelo: eso lo hace el worker cuando la ráfaga se apaga.
 */
export async function ingest(
  db: Db,
  msg: IncomingMessage,
  now: Date = new Date(),
): Promise<IngestResult> {
  const [chat] = await db
    .insert(chats)
    .values({
      jid: msg.jid,
      nombre: msg.nombre ?? null,
      esGrupo: msg.esGrupo,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: chats.jid,
      set: {
        // El nombre puede cambiar; `tracked` es del usuario y nunca se pisa.
        nombre: sql`coalesce(excluded.nombre, ${chats.nombre})`,
        lastSeenAt: now,
      },
    })
    .returning();

  if (!chat?.tracked) return "ignorado";
  if (msg.body.trim() === "") return "ignorado";

  const encolado = await db
    .insert(inbox)
    .values({
      jid: msg.jid,
      waMessageId: msg.waMessageId,
      autor: msg.autor ?? null,
      body: msg.body,
      sentAt: msg.sentAt,
    })
    .onConflictDoNothing({ target: inbox.waMessageId })
    .returning();

  if (encolado.length === 0) return "duplicado";

  await db
    .update(chats)
    .set({
      // Marca el inicio de la tanda. No se pisa: los mensajes siguientes
      // de la misma ráfaga conservan el arranque original.
      pendingSince: sql`coalesce(${chats.pendingSince}, ${now})`,
      lastMessageAt: now,
    })
    .where(sql`${chats.jid} = ${msg.jid}`);

  return "encolado";
}
