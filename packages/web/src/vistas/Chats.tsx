import { useEffect, useState } from "react";
import { api, type Chat } from "../api.js";

export function Chats({ alFallar }: { alFallar: (e: unknown) => void }) {
  const [chats, setChats] = useState<Chat[] | null>(null);

  useEffect(() => {
    api.chats().then(setChats).catch(alFallar);
  }, []);

  async function alternar(chat: Chat) {
    const tracked = !chat.tracked;
    setChats((previos) =>
      (previos ?? []).map((c) => (c.jid === chat.jid ? { ...c, tracked } : c)),
    );
    try {
      await api.observar(chat.jid, tracked);
    } catch (e) {
      alFallar(e);
      api.chats().then(setChats).catch(alFallar);
    }
  }

  if (chats === null) return null;

  const observados = chats.filter((c) => c.tracked);
  const resto = chats.filter((c) => !c.tracked);

  return (
    <>
      <p className="vacio" style={{ padding: "0.5rem 0 0", textAlign: "left" }}>
        De los chats que observás se leen los mensajes. De los demás no se guarda nada.
      </p>

      {observados.length > 0 ? (
        <section className="seccion">
          <h2 className="seccion-titulo">Observados</h2>
          {observados.map((c) => (
            <FilaChat key={c.jid} chat={c} alAlternar={alternar} />
          ))}
        </section>
      ) : null}

      <section className="seccion">
        <h2 className="seccion-titulo">{observados.length > 0 ? "Los demás" : "Tus chats"}</h2>
        {resto.length === 0 ? (
          <div className="vacio">
            <strong>Todavía no llegó ningún mensaje.</strong>
            Los chats aparecen acá solos cuando entra el primer mensaje.
          </div>
        ) : (
          resto.map((c) => <FilaChat key={c.jid} chat={c} alAlternar={alternar} />)
        )}
      </section>
    </>
  );
}

function FilaChat({ chat, alAlternar }: { chat: Chat; alAlternar: (c: Chat) => void }) {
  const nombre = chat.nombre ?? chat.jid.split("@")[0];
  return (
    <div className="chat-fila">
      <div>
        <div className="chat-nombre">
          {nombre}
          {chat.esGrupo ? " · grupo" : ""}
        </div>
        <div className="chat-jid">{chat.jid}</div>
      </div>
      <button
        className="interruptor"
        aria-pressed={chat.tracked}
        aria-label={chat.tracked ? `Dejar de observar ${nombre}` : `Observar ${nombre}`}
        onClick={() => alAlternar(chat)}
      />
    </div>
  );
}
