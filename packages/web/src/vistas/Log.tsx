import { useEffect, useState } from "react";
import { api, type Cambio } from "../api.js";

const VERBO: Record<Cambio["accion"], string> = {
  crear: "Anotó",
  editar: "Cambió",
  cerrar: "Cerró",
  reabrir: "Reabrió",
};

export function Log({ alFallar }: { alFallar: (e: unknown) => void }) {
  const [cambios, setCambios] = useState<Cambio[] | null>(null);

  useEffect(() => {
    api.log().then(setCambios).catch(alFallar);
  }, []);

  if (cambios === null) return null;

  if (cambios.length === 0) {
    return (
      <div className="vacio">
        <strong>Todavía no pasó nada.</strong>
        Acá vas a ver cada cosa que el agente cambió, y por qué.
      </div>
    );
  }

  return (
    <section className="seccion">
      <h2 className="seccion-titulo">Qué pasó</h2>
      {cambios.map((c) => (
        <article
          key={c.id}
          className={`cambio ${c.jid ? "del-agente" : ""} ${c.undoneAt ? "deshecho" : ""}`}
        >
          <div className="cambio-encabezado">
            <span className="cambio-accion">{VERBO[c.accion]}</span>
            <span className="cambio-fecha">
              {new Date(c.createdAt).toLocaleString("es-AR", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>

          <div style={{ marginTop: "0.2rem" }}>{c.item.content}</div>

          {c.motivo ? (
            <p className="procedencia" style={{ marginTop: "0.35rem" }}>
              <cite>“{c.motivo}”</cite>
            </p>
          ) : null}

          {c.jid && !c.undoneAt ? (
            <a
              className="item-link"
              href={`/u/${c.id}/${c.undo_token}`}
              style={{ marginTop: "0.45rem" }}
            >
              Deshacer
            </a>
          ) : null}

          {c.undoneAt ? <div className="cambio-fecha">Deshecho</div> : null}
        </article>
      ))}
    </section>
  );
}
