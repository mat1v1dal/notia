import { and, eq } from "drizzle-orm";
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

/** Campos que un editor —agente o usuario— puede tocar. */
export type ItemPatch = Partial<
  Pick<Item, "content" | "url" | "dueAt" | "context" | "tags">
>;

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

function itemWhere(id: number, scope: Scope) {
  return scope.scopeJid
    ? and(eq(items.id, id), eq(items.sourceJid, scope.scopeJid))
    : eq(items.id, id);
}

/** Devuelve el item actualizado, o `null` si no existe o quedó fuera del alcance. */
export async function updateItem(
  db: DbOrTx,
  id: number,
  patch: ItemPatch,
  actor: Actor,
  scope: Scope,
): Promise<Item | null> {
  return db.transaction(async (tx) => {
    const where = itemWhere(id, scope);

    const [antes] = await tx.select().from(items).where(where).for("update");
    if (!antes) return null;

    const [despues] = await tx
      .update(items)
      .set({ ...patch, updatedAt: new Date() })
      .where(where)
      .returning();
    if (!despues) return null;

    await tx.insert(itemChanges).values({
      itemId: id,
      accion: "editar",
      antes,
      despues,
      jid: actor.jid,
      motivo: actor.motivo,
      responseId: actor.responseId ?? null,
    });

    return despues;
  });
}
