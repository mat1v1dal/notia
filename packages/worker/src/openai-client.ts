import { toolDefinitions } from "@notia/core/agent";
import type { ModelClient, ModelTurn } from "@notia/core/dispatch";
import OpenAI from "openai";
import { toModelTurn, type RawResponse } from "./openai-mapping.js";

export type OpenAIModelClientOptions = {
  apiKey: string;
  model?: string;
  /** Umbral de compactación server-side, en tokens. */
  compactThreshold?: number;
};

/**
 * Implementación real de `ModelClient` sobre la Responses API.
 *
 * Adaptador fino a propósito: el loop de herramientas, el alcance y el
 * manejo de la cola viven en `@notia/core/dispatch`, donde se testean sin
 * red. Acá solo se traducen argumentos y respuestas.
 */
export function createOpenAIModelClient(opts: OpenAIModelClientOptions): ModelClient {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const model = opts.model ?? "gpt-5.6-luna";
  const compactThreshold = opts.compactThreshold ?? 40_000;

  const comun = {
    model,
    tools: toolDefinitions(),
    // La API resume el historial viejo cuando pasa el umbral y devuelve un
    // item de compactación. No hay resumidor propio que mantener.
    context_management: [{ type: "compaction", compact_threshold: compactThreshold }],
  };

  return {
    async start({ conversationId, instructions, input, conversationMetadata }): Promise<ModelTurn> {
      const conversation =
        conversationId ??
        (await client.conversations.create({ metadata: conversationMetadata ?? {} })).id;

      const res = (await client.responses.create({
        ...comun,
        conversation,
        instructions,
        input,
      } as never)) as unknown as RawResponse;

      return toModelTurn(res, conversation);
    },

    async submitToolOutputs({ conversationId, instructions, outputs }): Promise<ModelTurn> {
      const res = (await client.responses.create({
        ...comun,
        conversation: conversationId,
        instructions,
        input: outputs.map((o) => ({
          type: "function_call_output",
          call_id: o.callId,
          output: o.output,
        })),
      } as never)) as unknown as RawResponse;

      return toModelTurn(res, conversationId);
    },
  };
}
