import { useState } from "react";
import type { Item } from "../api.js";
import { comoTexto, estaVencido } from "../fecha.js";

export const TZ = "America/Argentina/Buenos_Aires";

export type Procedencia = { motivo: string | null; chat: string | null };

/**
 * Una línea de la lista.
 *
 * La barra verde al margen es la marca del agente: si está, el item no lo
 * escribiste vos. Es lo único que distingue una decisión de la máquina de
 * una tuya, y por eso es la decisión visual más cargada de la pantalla.
 */
export function ItemFila({
  item,
  procedencia,
  alAlternar,
}: {
  item: Item;
  procedencia?: Procedencia;
  alAlternar: (item: Item) => void;
}) {
  const [saliendo, setSaliendo] = useState(false);
  const hecho = item.doneAt !== null;
  const ahora = new Date();
  const vencido = !hecho && estaVencido(item.dueAt, ahora);
  const delAgente = item.sourceJid !== null;

  function alternar() {
    if (!hecho) {
      setSaliendo(true);
      setTimeout(() => alAlternar(item), 180);
    } else {
      alAlternar(item);
    }
  }

  return (
    <article
      className={[
        "item",
        delAgente ? "del-agente" : "",
        hecho ? "hecho" : "",
        saliendo ? "cerrandose" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        className={`tilde ${hecho ? "hecho" : ""}`}
        onClick={alternar}
        aria-label={hecho ? `Reabrir ${item.content}` : `Marcar ${item.content} como hecho`}
      />

      <div className="item-cuerpo">
        <div className="item-linea">
          <span className="item-texto">{item.content}</span>
          {item.dueAt ? (
            <time className={`item-cuando ${vencido ? "vencido" : ""}`} dateTime={item.dueAt}>
              {comoTexto(item.dueAt, ahora, TZ)}
            </time>
          ) : null}
        </div>

        {item.url ? (
          <a className="item-link" href={item.url} target="_blank" rel="noreferrer">
            {new URL(item.url).hostname}
          </a>
        ) : null}

        {procedencia?.motivo ? (
          <p className="procedencia">
            <cite>“{procedencia.motivo}”</cite>
            {procedencia.chat ? <span className="chat"> · {procedencia.chat}</span> : null}
          </p>
        ) : null}
      </div>
    </article>
  );
}
