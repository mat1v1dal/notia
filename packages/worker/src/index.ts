import { connect } from "@notia/core/connect";
import { dispatchDueChats } from "@notia/core/dispatch";
import { createEvolutionNotifier } from "@notia/core/notifier";
import { runChangeDigest, runMorningDigest, runReminders } from "@notia/core/scheduler";
import { undoToken } from "@notia/core/undo";
import { createOpenAIModelClient } from "./openai-client.js";

function requerido(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`falta la variable de entorno ${nombre}`);
  return valor;
}

const { db } = await connect(requerido("DATABASE_URL"), { migrate: false });

const timezone = process.env.TZ_USUARIO ?? "America/Argentina/Buenos_Aires";
const baseUrl = requerido("APP_BASE_URL").replace(/\/$/, "");
const secret = requerido("APP_SECRET");

const model = createOpenAIModelClient({
  apiKey: requerido("OPENAI_API_KEY"),
  model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
  compactThreshold: Number(process.env.COMPACT_THRESHOLD ?? 40_000),
});

const notifier = createEvolutionNotifier({
  baseUrl: requerido("EVOLUTION_URL").replace(/\/$/, ""),
  instance: requerido("EVOLUTION_INSTANCE"),
  apiKey: requerido("EVOLUTION_API_KEY"),
  destinoJid: requerido("MI_JID"),
});

const opcionesScheduler = {
  timezone,
  leadMs: Number(process.env.LEAD_MINUTOS ?? 60) * 60_000,
  undoLink: (id: number) => `${baseUrl}/u/${id}/${undoToken(id, secret)}`,
};

/** Corre un job aislando su error: que uno falle no debe frenar a los otros. */
async function aislado(nombre: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`[${nombre}]`, (e as Error).message);
  }
}

// Los dos jobs no comparten estado. Si el agente se cuelga esperando al
// modelo, los recordatorios siguen saliendo igual.
async function tick(): Promise<void> {
  await Promise.all([
    aislado("agente", () => dispatchDueChats(db, model, { timezone })),
    aislado("recordatorios", async () => {
      await runReminders(db, notifier, opcionesScheduler);
      await runMorningDigest(db, notifier, opcionesScheduler);
      await runChangeDigest(db, notifier, opcionesScheduler);
    }),
  ]);
}

console.log("notia-worker arrancado");
await tick();
setInterval(() => void tick(), 30_000);
