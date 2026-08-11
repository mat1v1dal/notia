import { useState } from "react";
import { api } from "../api.js";

export function Entrar({ alEntrar }: { alEntrar: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await api.entrar(password);
      alEntrar();
    } catch {
      setError("Esa contraseña no es.");
      setEnviando(false);
    }
  }

  return (
    <div className="app">
      <header className="barra">
        <h1 className="marca">
          not<span>ia</span>
        </h1>
      </header>

      <form className="seccion" onSubmit={enviar} style={{ maxWidth: "22rem" }}>
        <h2 className="seccion-titulo">Entrar</h2>

        <input
          className="campo"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          aria-label="Contraseña"
          autoFocus
        />

        {error ? (
          <p className="error" style={{ marginTop: "0.6rem" }}>
            {error}
          </p>
        ) : null}

        <button className="boton" type="submit" disabled={enviando} style={{ marginTop: "0.8rem" }}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
