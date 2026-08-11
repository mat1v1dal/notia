/**
 * Canal de salida hacia el usuario.
 *
 * Existe como interfaz para que agregar Web Push en v2 sea registrar otra
 * implementación sin tocar el worker ni el scheduler.
 */
export type Notifier = {
  send(text: string): Promise<void>;
};

export type EvolutionOptions = {
  /** URL base de la instancia de Evolution, sin barra final. */
  baseUrl: string;
  /** Nombre de la instancia configurada en Evolution. */
  instance: string;
  apiKey: string;
  /** JID del chat propio: todo aviso del sistema va acá, nunca al grupo observado. */
  destinoJid: string;
};

/**
 * Envío por WhatsApp vía Evolution API.
 *
 * El destino es siempre el chat propio del usuario. Los grupos observados
 * se leen, no se escriben: son conversaciones de otra gente.
 */
export function createEvolutionNotifier(opts: EvolutionOptions): Notifier {
  return {
    async send(text: string): Promise<void> {
      const res = await fetch(`${opts.baseUrl}/message/sendText/${opts.instance}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: opts.apiKey,
        },
        body: JSON.stringify({ number: opts.destinoJid, text }),
      });

      if (!res.ok) {
        throw new Error(`Evolution respondió ${res.status}: ${await res.text()}`);
      }
    },
  };
}
