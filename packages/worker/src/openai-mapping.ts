import type { ModelTurn } from "@notia/core/dispatch";

/**
 * Forma mínima de la respuesta que nos importa. Se tipa acá en vez de usar
 * el tipo del SDK para que el mapeo se pueda testear con objetos planos y
 * para que un cambio menor del SDK no rompa el parseo en silencio.
 */
export type RawResponse = {
  id: string;
  output: RawOutputItem[];
};

type RawOutputItem =
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "message"; role: string; content: { type: string; text?: string }[] }
  | { type: string; [k: string]: unknown };

/**
 * Traduce una respuesta de la Responses API al turno que entiende el
 * despachador.
 *
 * Si hay aunque sea una llamada a herramienta, el turno es `tool_calls`
 * aunque venga acompañada de texto: el texto en ese caso es preámbulo, no
 * la respuesta final.
 */
export function toModelTurn(res: RawResponse, conversationId: string): ModelTurn {
  const calls = res.output
    .filter(
      (o): o is Extract<RawOutputItem, { type: "function_call" }> => o.type === "function_call",
    )
    .map((o) => ({
      callId: o.call_id,
      name: o.name,
      argumentsJson: o.arguments,
    }));

  if (calls.length > 0) {
    return { kind: "tool_calls", responseId: res.id, conversationId, calls };
  }

  const text = res.output
    .filter((o): o is Extract<RawOutputItem, { type: "message" }> => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .map((c) => c.text ?? "")
    .join("")
    .trim();

  return { kind: "done", responseId: res.id, conversationId, text };
}
