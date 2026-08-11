import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Un chat de WhatsApp. Es un interruptor, no un registro de conversación:
 * guardamos si lo observamos y con qué conversación de OpenAI está asociado.
 * El contenido de los mensajes NO vive acá.
 */
export const chats = pgTable("chats", {
  jid: text("jid").primaryKey(),
  nombre: text("nombre"),
  esGrupo: boolean("es_grupo").notNull().default(false),
  tracked: boolean("tracked").notNull().default(false),
  /** `conv_…` devuelto por OpenAI. Null hasta el primer turno del chat. */
  conversationId: text("conversation_id"),
  /** Marca que hay una tanda sin procesar. Null = nada pendiente. */
  pendingSince: timestamp("pending_since", { withTimezone: true }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  /** Reintentos del turno actual. Se resetea al éxito. */
  agentAttempts: integer("agent_attempts").notNull().default(0),
});

/**
 * Cola efímera de mensajes entrantes. Se vacía en cada turno del agente.
 * Existe para que una ráfaga se colapse en una sola llamada y para que
 * el turno sea atómico y reintentable.
 */
export const inbox = pgTable(
  "inbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jid: text("jid")
      .notNull()
      .references(() => chats.jid),
    /** ID del mensaje en WhatsApp. Dedup de reintentos de Evolution. */
    waMessageId: text("wa_message_id").notNull(),
    autor: text("autor"),
    body: text("body").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("inbox_wa_message_id_key").on(t.waMessageId),
    index("inbox_jid_sent_at_idx").on(t.jid, t.sentAt),
  ],
);

/**
 * La unidad de información del sistema. El tipo es emergente:
 * con `dueAt` es recordatorio, con `url` es material, sin nada más es nota.
 */
export const items = pgTable(
  "items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    content: text("content").notNull(),
    url: text("url"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    /** facultad | trabajo | personal */
    context: text("context"),
    tags: text("tags").array().notNull().default([]),
    /** whatsapp | web */
    source: text("source").notNull(),
    /** Chat que lo originó. Null = creado desde la web, fuera del alcance de cualquier agente. */
    sourceJid: text("source_jid").references(() => chats.jid),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("items_done_due_idx").on(t.doneAt, t.dueAt),
    index("items_source_jid_open_idx")
      .on(t.sourceJid)
      .where(sql`done_at IS NULL`),
  ],
);

/**
 * El log. Ningún camino modifica un item sin escribir acá.
 * Es lo que hace el sistema auditable y reversible.
 */
export const itemChanges = pgTable(
  "item_changes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    itemId: bigint("item_id", { mode: "number" })
      .notNull()
      .references(() => items.id),
    /** crear | editar | cerrar | reabrir */
    accion: text("accion").notNull(),
    antes: jsonb("antes"),
    despues: jsonb("despues"),
    /** Chat que originó el cambio. Null = lo hizo el usuario desde la web. */
    jid: text("jid").references(() => chats.jid),
    /** Lo que el agente declaró como razón. Es lo que hace legible el log. */
    motivo: text("motivo"),
    /** Trazabilidad al turno de OpenAI que lo produjo. */
    responseId: text("response_id"),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("item_changes_unnotified_idx").on(t.notifiedAt)],
);

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type InboxRow = typeof inbox.$inferSelect;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type ItemChange = typeof itemChanges.$inferSelect;

/**
 * Estado operativo de los jobs periódicos. No es dominio: existe para que
 * un reinicio del worker no repita un digest ya enviado.
 */
export const jobRuns = pgTable("job_runs", {
  name: text("name").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
});

export type JobRun = typeof jobRuns.$inferSelect;
