import { z } from "zod";
import type { DbOrTx } from "./db.js";
import { closeItem, createItem, openItemsForChat, searchItems, updateItem } from "./items.js";

/** Una llamada a herramienta tal como la emite el modelo. */
export type ToolCall = {
  callId: string;
  name: string;
  /** JSON crudo. Viene de un modelo: se valida, nunca se confía. */
  argumentsJson: string;
};

/** Lo que se devuelve al modelo como resultado de la llamada. */
export type ToolOutput = { callId: string; output: string };

/** Contexto del turno. `jid` es la frontera de alcance de todas las herramientas. */
export type TurnContext = { jid: string; responseId: string };

const fechaIso = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "debe ser una fecha ISO 8601");

const contexto = z.enum(["facultad", "trabajo", "personal"]);

const schemas = {
  crear_item: z.object({
    content: z.string().min(1),
    motivo: z.string().min(1),
    url: z.string().optional(),
    due_at: fechaIso.optional(),
    context: contexto.optional(),
    tags: z.array(z.string()).optional(),
  }),
  editar_item: z.object({
    id: z.number().int().positive(),
    motivo: z.string().min(1),
    content: z.string().min(1).optional(),
    url: z.string().optional(),
    due_at: fechaIso.nullable().optional(),
    context: contexto.optional(),
    tags: z.array(z.string()).optional(),
  }),
  cerrar_item: z.object({
    id: z.number().int().positive(),
    motivo: z.string().min(1),
  }),
  buscar_items: z.object({
    query: z.string().min(1),
  }),
} as const;

export type ToolName = keyof typeof schemas;

export const NOMBRES_DE_HERRAMIENTAS = Object.keys(schemas) as ToolName[];

function ok(callId: string, data: Record<string, unknown>): ToolOutput {
  return { callId, output: JSON.stringify({ ok: true, ...data }) };
}

function fail(callId: string, error: string): ToolOutput {
  return { callId, output: JSON.stringify({ ok: false, error }) };
}

/** Vista compacta de un item para devolverle al modelo. */
function resumen(item: {
  id: number;
  content: string;
  dueAt: Date | null;
  doneAt: Date | null;
}) {
  return {
    id: item.id,
    content: item.content,
    due_at: item.dueAt?.toISOString() ?? null,
    cerrado: item.doneAt !== null,
  };
}

/**
 * Ejecuta una llamada a herramienta del agente.
 *
 * Nunca lanza: todo error —herramienta inexistente, argumentos inválidos,
 * item fuera de alcance— vuelve al modelo como resultado, para que pueda
 * corregirse solo y para que un turno raro no tumbe al worker.
 *
 * El alcance es `ctx.jid`: las herramientas que tocan items existentes solo
 * alcanzan los que nacieron en ese chat.
 */
export async function applyToolCall(
  db: DbOrTx,
  ctx: TurnContext,
  call: ToolCall,
): Promise<ToolOutput> {
  const { callId } = call;

  if (!(call.name in schemas)) {
    return fail(callId, `la herramienta "${call.name}" no existe`);
  }
  const name = call.name as ToolName;

  let raw: unknown;
  try {
    raw = JSON.parse(call.argumentsJson);
  } catch {
    return fail(callId, "los argumentos no son JSON válido");
  }

  const parsed = schemas[name].safeParse(raw);
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join("; ");
    return fail(callId, `argumentos inválidos — ${detalle}`);
  }

  const actor = { jid: ctx.jid, responseId: ctx.responseId } as const;
  const scope = { scopeJid: ctx.jid } as const;

  try {
    switch (name) {
      case "crear_item": {
        const a = parsed.data as z.infer<(typeof schemas)["crear_item"]>;
        const item = await createItem(
          db,
          {
            content: a.content,
            url: a.url ?? null,
            dueAt: a.due_at ? new Date(a.due_at) : null,
            context: a.context ?? null,
            tags: a.tags ?? [],
            source: "whatsapp",
            sourceJid: ctx.jid,
          },
          { ...actor, motivo: a.motivo },
        );
        return ok(callId, { item: resumen(item) });
      }

      case "editar_item": {
        const a = parsed.data as z.infer<(typeof schemas)["editar_item"]>;
        const patch = {
          ...(a.content !== undefined && { content: a.content }),
          ...(a.url !== undefined && { url: a.url }),
          ...(a.due_at !== undefined && { dueAt: a.due_at ? new Date(a.due_at) : null }),
          ...(a.context !== undefined && { context: a.context }),
          ...(a.tags !== undefined && { tags: a.tags }),
        };
        const item = await updateItem(db, a.id, patch, { ...actor, motivo: a.motivo }, scope);
        return item
          ? ok(callId, { item: resumen(item) })
          : fail(callId, `item ${a.id} no encontrado en este chat`);
      }

      case "cerrar_item": {
        const a = parsed.data as z.infer<(typeof schemas)["cerrar_item"]>;
        const item = await closeItem(db, a.id, { ...actor, motivo: a.motivo }, scope);
        return item
          ? ok(callId, { item: resumen(item) })
          : fail(callId, `item ${a.id} no encontrado en este chat`);
      }

      case "buscar_items": {
        const a = parsed.data as z.infer<(typeof schemas)["buscar_items"]>;
        const encontrados = await searchItems(db, a.query, scope);
        return ok(callId, { items: encontrados.map(resumen) });
      }
    }
  } catch (e) {
    return fail(callId, `error aplicando ${name}: ${(e as Error).message}`);
  }
}

/** Snapshot de items abiertos para las `instructions` del turno. */
export async function itemsSnapshot(db: DbOrTx, jid: string): Promise<string> {
  const abiertos = await openItemsForChat(db, jid);
  if (abiertos.length === 0) return "No hay items abiertos de este chat.";
  return abiertos
    .map((i) => `#${i.id} ${i.content}${i.dueAt ? ` — vence ${i.dueAt.toISOString()}` : " — sin fecha"}`)
    .join("\n");
}
