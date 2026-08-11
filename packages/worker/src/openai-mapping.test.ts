import { expect, test } from "vitest";
import { toModelTurn } from "./openai-mapping.js";

const CONV = "conv_1";

test("una respuesta sin llamadas a herramientas es un turno terminado", () => {
  const turn = toModelTurn(
    {
      id: "resp_1",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "no hay nada que hacer" }],
        },
      ],
    },
    CONV,
  );

  expect(turn).toEqual({
    kind: "done",
    responseId: "resp_1",
    conversationId: CONV,
    text: "no hay nada que hacer",
  });
});

test("una respuesta con function_call se traduce a tool calls", () => {
  const turn = toModelTurn(
    {
      id: "resp_2",
      output: [
        {
          type: "function_call",
          call_id: "call_abc",
          name: "crear_item",
          arguments: '{"content":"entregar TP3","motivo":"Ana lo dijo"}',
        },
      ],
    },
    CONV,
  );

  expect(turn).toEqual({
    kind: "tool_calls",
    responseId: "resp_2",
    conversationId: CONV,
    calls: [
      {
        callId: "call_abc",
        name: "crear_item",
        argumentsJson: '{"content":"entregar TP3","motivo":"Ana lo dijo"}',
      },
    ],
  });
});

test("varias llamadas en la misma respuesta se preservan en orden", () => {
  const turn = toModelTurn(
    {
      id: "resp_3",
      output: [
        { type: "function_call", call_id: "c1", name: "buscar_items", arguments: "{}" },
        { type: "function_call", call_id: "c2", name: "crear_item", arguments: "{}" },
      ],
    },
    CONV,
  );

  expect(turn.kind).toBe("tool_calls");
  expect(turn.kind === "tool_calls" && turn.calls.map((c) => c.callId)).toEqual(["c1", "c2"]);
});

test("el texto acompañando a una llamada no la enmascara", () => {
  const turn = toModelTurn(
    {
      id: "resp_4",
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "voy a anotarlo" }] },
        { type: "function_call", call_id: "c1", name: "crear_item", arguments: "{}" },
      ],
    },
    CONV,
  );

  expect(turn.kind).toBe("tool_calls");
});

test("los items de compactación no se confunden con llamadas ni con texto", () => {
  const turn = toModelTurn(
    { id: "resp_5", output: [{ type: "compaction" }] },
    CONV,
  );

  expect(turn).toEqual({ kind: "done", responseId: "resp_5", conversationId: CONV, text: "" });
});
