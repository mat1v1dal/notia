import { expect, test } from "vitest";
import { undoToken, verifyUndoToken } from "./undo.js";

const SECRETO = "un-secreto-de-servidor";

test("el token de un cambio verifica contra ese mismo cambio", () => {
  const token = undoToken(42, SECRETO);

  expect(verifyUndoToken(42, token, SECRETO)).toBe(true);
});

test("el token de un cambio no sirve para otro cambio", () => {
  const token = undoToken(42, SECRETO);

  expect(verifyUndoToken(43, token, SECRETO)).toBe(false);
});

test("un token firmado con otro secreto no verifica", () => {
  const token = undoToken(42, "otro-secreto");

  expect(verifyUndoToken(42, token, SECRETO)).toBe(false);
});

test("un token basura no verifica y no rompe", () => {
  expect(verifyUndoToken(42, "", SECRETO)).toBe(false);
  expect(verifyUndoToken(42, "no-es-un-token", SECRETO)).toBe(false);
  expect(verifyUndoToken(42, "a".repeat(500), SECRETO)).toBe(false);
});

test("el token es corto y seguro para una URL", () => {
  const token = undoToken(42, SECRETO);

  expect(token).toMatch(/^[A-Za-z0-9_-]{10}$/);
});
