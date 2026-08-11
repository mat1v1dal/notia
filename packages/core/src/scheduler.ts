import { and, asc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import type { Db } from "./db.js";
import type { Notifier } from "./notifier.js";
import { chats, itemChanges, items, jobRuns, type Item, type ItemChange } from "./schema.js";

export type SchedulerOptions = {
  now?: Date;
  timezone?: string;
  /** Cuánto antes del vencimiento avisar. */
  leadMs?: number;
  /** Hora local del digest matinal. */
  morningHour?: number;
  /** Cómo construir el link de deshacer de un cambio. */
  undoLink?: (changeId: number) => string;
};

const DEFAULTS = {
  timezone: "America/Argentina/Buenos_Aires",
  leadMs: 60 * 60_000,
  morningHour: 8,
};

/** Partes de una fecha en una zona horaria dada. */
function enZona(d: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return {
    fecha: `${get("year")}-${get("month")}-${get("day")}`,
    hora: Number(get("hour")),
    minuto: Number(get("minute")),
  };
}

/** Un item "sin hora" es el que vence a las 00:00 locales: es una fecha, no un momento. */
function esFechaSinHora(item: Item, timeZone: string): boolean {
  if (!item.dueAt) return false;
  const { hora, minuto } = enZona(item.dueAt, timeZone);
  return hora === 0 && minuto === 0;
}

function formatearItem(item: Item, timeZone: string): string {
  if (!item.dueAt) return `• ${item.content}`;
  const { hora, minuto } = enZona(item.dueAt, timeZone);
  const cuando = esFechaSinHora(item, timeZone)
    ? "hoy"
    : `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
  return `• ${item.content} — ${cuando}`;
}

/**
 * Aviso puntual de vencimientos.
 *
 * Es el único camino que escribe `items.notified_at` para items con hora;
 * el digest matinal no lo toca, así que un item que aparece en el digest
 * igual recibe después su aviso.
 *
 * Los items con fecha pero sin hora quedan afuera: avisarlos a medianoche
 * no le sirve a nadie. De esos se ocupa el digest.
 */
export async function runReminders(
  db: Db,
  notifier: Notifier,
  opts: SchedulerOptions = {},
): Promise<number> {
  const o = { ...DEFAULTS, ...opts };
  const now = opts.now ?? new Date();
  const corte = new Date(now.getTime() + o.leadMs);

  const vencen = await db
    .select()
    .from(items)
    .where(
      and(
        isNull(items.doneAt),
        isNull(items.notifiedAt),
        isNotNull(items.dueAt),
        lte(items.dueAt, corte),
      ),
    )
    .orderBy(asc(items.dueAt));

  const aAvisar = vencen.filter((i) => !esFechaSinHora(i, o.timezone));
  if (aAvisar.length === 0) return 0;

  const cuerpo = aAvisar.map((i) => formatearItem(i, o.timezone)).join("\n");
  await notifier.send(`⏰ Se viene:\n${cuerpo}`);

  await db
    .update(items)
    .set({ notifiedAt: now })
    .where(
      inArray(
        items.id,
        aAvisar.map((i) => i.id),
      ),
    );

  return aAvisar.length;
}

/**
 * Resumen de la mañana con todo lo que vence hoy.
 *
 * Corre una vez por día a la hora local configurada. Solo marca notificados
 * los items sin hora, que de otro modo no recibirían aviso nunca.
 */
export async function runMorningDigest(
  db: Db,
  notifier: Notifier,
  opts: SchedulerOptions = {},
): Promise<boolean> {
  const o = { ...DEFAULTS, ...opts };
  const now = opts.now ?? new Date();
  const hoy = enZona(now, o.timezone);

  if (hoy.hora !== o.morningHour) return false;

  const [ultima] = await db.select().from(jobRuns).where(eq(jobRuns.name, "morning_digest"));
  if (ultima && enZona(ultima.lastRunAt, o.timezone).fecha === hoy.fecha) return false;

  const abiertos = await db
    .select()
    .from(items)
    .where(and(isNull(items.doneAt), isNotNull(items.dueAt)))
    .orderBy(asc(items.dueAt));

  const deHoy = abiertos.filter((i) => enZona(i.dueAt!, o.timezone).fecha === hoy.fecha);

  await db
    .insert(jobRuns)
    .values({ name: "morning_digest", lastRunAt: now })
    .onConflictDoUpdate({ target: jobRuns.name, set: { lastRunAt: now } });

  if (deHoy.length === 0) return false;

  await notifier.send(`☀️ Hoy:\n${deHoy.map((i) => formatearItem(i, o.timezone)).join("\n")}`);

  const sinHora = deHoy.filter((i) => esFechaSinHora(i, o.timezone) && i.notifiedAt === null);
  if (sinHora.length > 0) {
    await db
      .update(items)
      .set({ notifiedAt: now })
      .where(
        inArray(
          items.id,
          sinHora.map((i) => i.id),
        ),
      );
  }

  return true;
}

const VERBO: Record<string, string> = {
  crear: "➕ Nuevo",
  editar: "🔄 Cambié",
  cerrar: "✅ Cerré",
  reabrir: "↩️ Reabrí",
};

/**
 * Avisos de lo que hizo el agente, agrupados en un solo mensaje.
 *
 * Un WhatsApp por cambio sería insoportable. Los cambios hechos por el
 * usuario desde la web no se avisan: ya los sabe.
 */
export async function runChangeDigest(
  db: Db,
  notifier: Notifier,
  opts: SchedulerOptions = {},
): Promise<number> {
  const now = opts.now ?? new Date();

  const pendientes = await db
    .select({ cambio: itemChanges, item: items, chat: chats })
    .from(itemChanges)
    .innerJoin(items, eq(itemChanges.itemId, items.id))
    .leftJoin(chats, eq(itemChanges.jid, chats.jid))
    .where(and(isNull(itemChanges.notifiedAt), isNotNull(itemChanges.jid)))
    .orderBy(asc(itemChanges.id));

  if (pendientes.length === 0) return 0;

  const porChat = new Map<string, typeof pendientes>();
  for (const fila of pendientes) {
    const clave = fila.chat?.nombre ?? fila.cambio.jid ?? "sin chat";
    const grupo = porChat.get(clave) ?? [];
    grupo.push(fila);
    porChat.set(clave, grupo);
  }

  const bloques: string[] = [];
  for (const [nombre, filas] of porChat) {
    const lineas = filas.map(({ cambio, item }) => {
      const verbo = VERBO[cambio.accion] ?? cambio.accion;
      const motivo = cambio.motivo ? `\n   "${cambio.motivo}"` : "";
      const link = opts.undoLink ? `\n   deshacer: ${opts.undoLink(cambio.id)}` : "";
      return `${verbo}: ${item.content}${motivo}${link}`;
    });
    bloques.push(`${nombre}\n${lineas.join("\n")}`);
  }

  await notifier.send(bloques.join("\n\n"));

  await db
    .update(itemChanges)
    .set({ notifiedAt: now })
    .where(
      inArray(
        itemChanges.id,
        pendientes.map((p) => p.cambio.id),
      ),
    );

  return pendientes.length;
}

export type { Item, ItemChange };
