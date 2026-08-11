import { useEffect, useState } from "react";
import { api, type Item } from "../api.js";
import { ItemFila } from "./ItemFila.js";

export function Buscar({ alFallar }: { alFallar: (e: unknown) => void }) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Item[] | null>(null);

  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) {
      setResultados(null);
      return;
    }
    const t = setTimeout(() => {
      api.items({ q }).then(setResultados).catch(alFallar);
    }, 200);
    return () => clearTimeout(t);
  }, [texto]);

  async function alternar(item: Item) {
    try {
      const actualizado = item.doneAt ? await api.reabrir(item.id) : await api.cerrar(item.id);
      setResultados((previos) =>
        (previos ?? []).map((i) => (i.id === item.id ? actualizado : i)),
      );
    } catch (e) {
      alFallar(e);
    }
  }

  return (
    <>
      <input
        className="campo"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar en todo"
        aria-label="Buscar en todo"
        autoFocus
      />

      {resultados === null ? (
        <div className="vacio">Busca en lo abierto y en lo cerrado.</div>
      ) : resultados.length === 0 ? (
        <div className="vacio">
          <strong>Nada con “{texto.trim()}”.</strong>
          Probá con menos palabras.
        </div>
      ) : (
        <section className="seccion">
          <h2 className="seccion-titulo">
            {resultados.length} {resultados.length === 1 ? "resultado" : "resultados"}
          </h2>
          {resultados.map((item) => (
            <ItemFila key={item.id} item={item} alAlternar={alternar} />
          ))}
        </section>
      )}
    </>
  );
}
