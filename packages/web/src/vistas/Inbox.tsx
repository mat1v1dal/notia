import { useEffect, useState } from "react";
import { api, type Cambio, type Chat, type Item } from "../api.js";
import { agrupar } from "../fecha.js";
import { ItemFila, TZ, type Procedencia } from "./ItemFila.js";

export function Inbox({ alFallar }: { alFallar: (e: unknown) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [porQue, setPorQue] = useState<Record<number, Procedencia>>({});
  const [nuevo, setNuevo] = useState("");

  async function cargar() {
    try {
      const [items, log, chats] = await Promise.all([api.items(), api.log(), api.chats()]);
      setItems(items);

      // El último cambio del agente sobre cada item es su procedencia:
      // por qué está acá y quién lo dijo.
      const nombres = new Map(chats.map((c: Chat) => [c.jid, c.nombre ?? c.jid]));
      const mapa: Record<number, Procedencia> = {};
      for (const c of log as Cambio[]) {
        if (!c.jid || c.undoneAt || mapa[c.itemId]) continue;
        mapa[c.itemId] = { motivo: c.motivo, chat: nombres.get(c.jid) ?? c.jid };
      }
      setPorQue(mapa);
    } catch (e) {
      alFallar(e);
    }
  }

  useEffect(() => {
    void cargar();
  }, []);

  async function alternar(item: Item) {
    setItems((previos) => (previos ?? []).filter((i) => i.id !== item.id));
    try {
      await api.cerrar(item.id);
    } catch (e) {
      alFallar(e);
      void cargar();
    }
  }

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    const texto = nuevo.trim();
    if (!texto) return;
    setNuevo("");
    try {
      const item = await api.crear(texto);
      setItems((previos) => [item, ...(previos ?? [])]);
    } catch (e) {
      alFallar(e);
    }
  }

  if (items === null) return null;

  const grupos = agrupar(items, new Date(), TZ);

  return (
    <>
      {grupos.length === 0 ? (
        <div className="vacio">
          <strong>No tenés nada pendiente.</strong>
          Escribile a tu WhatsApp o anotá algo acá abajo.
        </div>
      ) : (
        grupos.map((grupo) => (
          <section className="seccion" key={grupo.titulo}>
            <h2 className={`seccion-titulo ${grupo.urgente ? "urgente" : ""}`}>{grupo.titulo}</h2>
            {grupo.items.map((item) => (
              <ItemFila
                key={item.id}
                item={item}
                procedencia={porQue[item.id]}
                alAlternar={alternar}
              />
            ))}
          </section>
        ))
      )}

      <form className="entrada" onSubmit={agregar}>
        <div className="entrada-caja">
          <input
            className="campo"
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            placeholder="Anotar algo…"
            aria-label="Anotar algo"
          />
          <button className="boton" type="submit">
            Anotar
          </button>
        </div>
      </form>
    </>
  );
}
