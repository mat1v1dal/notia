import { expect, test } from "vitest";
import { agrupar, comoTexto, estaVencido } from "./fecha.js";

const AHORA = new Date("2026-08-10T15:00:00-03:00"); // lunes 10/8, 15:00 local
const TZ = "America/Argentina/Buenos_Aires";

const item = (id: number, dueAt: string | null) => ({ id, dueAt, content: `item ${id}` });

test("agrupa por urgencia real, no por orden de creación", () => {
  const grupos = agrupar(
    [
      item(1, "2026-08-10T21:00:00Z"), // hoy 18:00
      item(2, "2026-08-13T14:00:00Z"), // jueves, esta semana
      item(3, "2026-09-01T14:00:00Z"), // el mes que viene
      item(4, null),
    ],
    AHORA,
    TZ,
  );

  expect(grupos.map((g) => g.titulo)).toEqual(["Hoy", "Esta semana", "Después", "Sin fecha"]);
  expect(grupos.map((g) => g.items.map((i) => i.id))).toEqual([[1], [2], [3], [4]]);
});

test("lo vencido encabeza la lista con su propio grupo", () => {
  const grupos = agrupar([item(1, "2026-08-08T14:00:00Z")], AHORA, TZ);

  expect(grupos[0]!.titulo).toBe("Vencido");
  expect(grupos[0]!.urgente).toBe(true);
});

test("un grupo vacío no aparece", () => {
  const grupos = agrupar([item(1, null)], AHORA, TZ);

  expect(grupos.map((g) => g.titulo)).toEqual(["Sin fecha"]);
});

test("dentro de un grupo lo más cercano va primero", () => {
  const grupos = agrupar(
    [item(1, "2026-08-10T23:00:00Z"), item(2, "2026-08-10T18:00:00Z")],
    AHORA,
    TZ,
  );

  expect(grupos[0]!.items.map((i) => i.id)).toEqual([2, 1]);
});

test("estaVencido compara contra el momento, no contra el día", () => {
  expect(estaVencido("2026-08-10T17:00:00Z", AHORA)).toBe(true); // 14:00 local, ya pasó
  expect(estaVencido("2026-08-10T21:00:00Z", AHORA)).toBe(false); // 18:00 local
  expect(estaVencido(null, AHORA)).toBe(false);
});

test("comoTexto muestra la hora si hoy, y el día si es más lejos", () => {
  expect(comoTexto("2026-08-10T21:00:00Z", AHORA, TZ)).toBe("18:00");
  expect(comoTexto("2026-08-13T21:00:00Z", AHORA, TZ)).toMatch(/jue/i);
  expect(comoTexto(null, AHORA, TZ)).toBe("");
});

test("un item que vence a las 00:00 locales se muestra como fecha, no como hora", () => {
  // 2026-08-11 00:00 en Buenos Aires = 03:00Z
  expect(comoTexto("2026-08-11T03:00:00Z", AHORA, TZ)).not.toBe("00:00");
});
