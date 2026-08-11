import type { IncomingMessage } from "@notia/core/ingest";

/**
 * Traduce el payload del webhook de Evolution a nuestro mensaje entrante.
 *
 * Devuelve `null` para todo lo que no sea un mensaje de texto: eventos de
 * conexión, stickers, imágenes sin caption, o payloads malformados. Es
 * entrada externa, así que nada se asume — se descarta en vez de romper.
 */
export function normalizeEvolutionMessage(payload: unknown): IncomingMessage | null {
  if (typeof payload !== "object" || payload === null) return null;

  const p = payload as Record<string, unknown>;
  if (p.event !== "messages.upsert") return null;

  const data = p.data as Record<string, unknown> | undefined;
  const key = data?.key as Record<string, unknown> | undefined;
  const jid = typeof key?.remoteJid === "string" ? key.remoteJid : null;
  const waMessageId = typeof key?.id === "string" ? key.id : null;
  if (!jid || !waMessageId) return null;

  const body = extraerTexto(data?.message);
  if (!body) return null;

  const esGrupo = jid.endsWith("@g.us");
  const pushName = typeof data?.pushName === "string" ? data.pushName : null;
  // En el chat propio los mensajes vienen marcados como nuestros: ahí el
  // autor somos nosotros, y ese chat es justamente el de captura libre.
  const autor = key?.fromMe === true ? "yo" : (pushName ?? "?");

  const ts = Number(data?.messageTimestamp);
  const sentAt = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date();

  return {
    jid,
    nombre: esGrupo ? pushName : pushName,
    esGrupo,
    waMessageId,
    autor,
    body,
    sentAt,
  };
}

function extraerTexto(message: unknown): string | null {
  if (typeof message !== "object" || message === null) return null;
  const m = message as Record<string, unknown>;

  if (typeof m.conversation === "string" && m.conversation.trim() !== "") {
    return m.conversation;
  }

  const extended = m.extendedTextMessage as Record<string, unknown> | undefined;
  if (typeof extended?.text === "string" && extended.text.trim() !== "") {
    return extended.text;
  }

  // Caption de una imagen o video: es texto que la conversación aporta.
  for (const clave of ["imageMessage", "videoMessage", "documentMessage"]) {
    const con = m[clave] as Record<string, unknown> | undefined;
    if (typeof con?.caption === "string" && con.caption.trim() !== "") {
      return con.caption;
    }
  }

  return null;
}
