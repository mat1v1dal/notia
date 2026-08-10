import { and, asc, eq, ilike, isNull } from "drizzle-orm";
import type { DbOrTx } from "./db.js";
import { itemChanges, items, type Item, type NewItem } from "./schema.js";

/**
 * Quién originó un cambio. Todo camino que muta un item exige uno:
 * es lo que hace que el log no se pueda saltear.
 */
export type Actor = {
  /** Chat que lo originó. Null = el usuario desde la web. */
  jid: string | null;
  /** Razón declarada. El agente la produce; la web puede dejarla en null. */
  motivo: string | null;
  /** Turno de OpenAI que lo produjo, para trazabilidad. */
  responseId?: string | null;
};

/** Campos que un editor —agente o usuario— puede tocar. */
export type ItemPatch = Partial<Pick<Item, "content" | "url" | "dueAt" | "context" | "tags">>;

/**
 * Restringe a qué items alcanza una operación.
 *
 * `scopeJid` es una frontera de seguridad: el agente de un chat solo puede
 * tocar items nacidos en ese chat. Se aplica como predicado SQL y no como
 * chequeo previo, para que no exista un camino que se lo saltee.
 *
 * Sin `scopeJid` la operación alcanza cualquier item — es el modo del usuario
 * desde la web, no el de ningún agente.
 */
export type Scope = { scopeJid?: string };

export type Accion = "crear" | "editar" | "cerrar" | "reabrir";

export async function createItem(db: DbOrTx, values: NewItem, actor: Actor): Promise<Item> {
  return db.transaction(async (tx) => {
    const [item] = await tx.insert(items).values(values).returning();
    if (!item) throw new Error("createItem: el insert no devolvió fila");

    await tx.insert(itemChanges).values({
      itemId: item.id,
      accion: "crear",
      antes: null,
      despues: item,
      jid: actor.jid,
      motivo: actor.motivo,
      responseId: actor.responseId ?? null,
    });

    return item;
  });
}

/**
 * Único camino de mutación de un item existente. Toma el lock de la fila,
 * aplica el cambio y escribe el log en la misma transacción.
 *
 * Devuelve `null` cuando el item no existe o quedó fuera del alcance; en ese
 * caso no se escribe nada, tampoco en el log.
 */
async function mutate(
  db: DbOrTx,
  id: number,
  accion: Exclude<Accion, "crear">,
  set: ItemPatch & { doneAt?: Date | null },
  actor: Actor,
  scope: Scope,
): Promise<Item | null> {
  return db.transaction(async (tx) => {
    const where = scope.scopeJid
      ? and(eq(items.id, id), eq(items.sourceJid, scope.scopeJid))
      : eq(items.id, id);

    const [antes] = await tx.select().from(items).where(where).for("update");
    if (!antes) return null;

    const [despues] = await tx
      .update(items)
      .set({ ...set, updatedAt: new Date() })
      .where(where)
      .returning();
    if (!despues) return null;

    await tx.insert(itemChanges).values({
      itemId: id,
      accion,
      antes,
      despues,
      jid: actor.jid,
      motivo: actor.motivo,
      responseId: actor.responseId ?? null,
    });

    return despues;
  });
}

/** Devuelve el item actualizado, o `null` si no existe o quedó fuera del alcance. */
export function updateItem(
  db: DbOrTx,
  id: number,
  patch: ItemPatch,
  actor: Actor,
  scope: Scope,
): Promise<Item | null> {
  return mutate(db, id, "editar", patch, actor, scope);
}

/**
 * Cierra un item. No existe borrado: cerrar es reversible, borrar no.
 * Es el límite duro sobre lo que un mensaje de un tercero puede provocar.
 */
export function closeItem(
  db: DbOrTx,
  id: number,
  actor: Actor,
  scope: Scope,
): Promise<Item | null> {
  return mutate(db, id, "cerrar", { doneAt: new Date() }, actor, scope);
}

export function reopenItem(
  db: DbOrTx,
  id: number,
  actor: Actor,
  scope: Scope,
): Promise<Item | null> {
  return mutate(db, id, "reabrir", { doneAt: null }, actor, scope);
}

/**
 * Items abiertos de un chat. Es el snapshot que va en las `instructions`
 * de cada turno del agente, para que vea el estado real sin gastar un
 * round-trip de `buscar_items`.
 */
export function openItemsForChat(db: DbOrTx, jid: string): Promise<Item[]> {
  return db
    .select()
    .from(items)
    .where(and(eq(items.sourceJid, jid), isNull(items.doneAt)))
    .orderBy(asc(items.dueAt), asc(items.id));
}

/**
 * Búsqueda por contenido. Con `scopeJid` queda acotada a los items de ese
 * chat, que es como la usa la herramienta `buscar_items` del agente.
 */
export function searchItems(db: DbOrTx, query: string, scope: Scope): Promise<Item[]> {
  const match = ilike(items.content, `%${query}%`);
  return db
    .select()
    .from(items)
    .where(scope.scopeJid ? and(match, eq(items.sourceJid, scope.scopeJid)) : match)
    .orderBy(asc(items.doneAt), asc(items.dueAt), asc(items.id))
    .limit(50);
}
