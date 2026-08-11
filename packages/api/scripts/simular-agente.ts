import { applyToolCall } from "@notia/core/agent";
import { connect } from "@notia/core/connect";
import { chats } from "@notia/core/schema";

const { db, close } = await connect(process.env.DATABASE_URL!);
await db
  .insert(chats)
  .values({ jid: "bases@g.us", nombre: "Bases de Datos II", tracked: true })
  .onConflictDoNothing();

const ctx = { jid: "bases@g.us", responseId: "resp_sim" };
const crear = await applyToolCall(db, ctx, {
  callId: "c1",
  name: "crear_item",
  argumentsJson: JSON.stringify({
    content: "entregar TP3 de bases",
    motivo: "Ana avisó la fecha en el grupo",
    due_at: "2026-08-13T21:00:00.000Z",
  }),
});
console.log("crear:", crear.output);
const id = JSON.parse(crear.output).item.id;

const editar = await applyToolCall(db, ctx, {
  callId: "c2",
  name: "editar_item",
  argumentsJson: JSON.stringify({
    id,
    motivo: "Ana avisó que se corre al viernes 18",
    due_at: "2026-08-18T21:00:00.000Z",
  }),
});
console.log("editar:", editar.output);
await close();
