import { expect, test } from "vitest";
import { normalizeEvolutionMessage } from "./evolution.js";

const base = {
  event: "messages.upsert",
  instance: "notia",
  data: {
    key: { remoteJid: "5491122334455@s.whatsapp.net", fromMe: false, id: "3EB0AAA" },
    pushName: "Ana",
    message: { conversation: "el TP3 se corre al viernes" },
    messageTimestamp: 1_754_838_180,
  },
};

test("un mensaje directo se normaliza con su jid, autor y texto", () => {
  const msg = normalizeEvolutionMessage(base);

  expect(msg).toEqual({
    jid: "5491122334455@s.whatsapp.net",
    nombre: "Ana",
    esGrupo: false,
    waMessageId: "3EB0AAA",
    autor: "Ana",
    body: "el TP3 se corre al viernes",
    sentAt: new Date(1_754_838_180 * 1000),
  });
});

test("en un grupo el jid es el del grupo y el autor es quien escribió", () => {
  const msg = normalizeEvolutionMessage({
    ...base,
    data: {
      ...base.data,
      key: {
        remoteJid: "120363000000000000@g.us",
        fromMe: false,
        id: "3EB0BBB",
        participant: "5491199887766@s.whatsapp.net",
      },
      pushName: "Juan",
    },
  });

  expect(msg?.jid).toBe("120363000000000000@g.us");
  expect(msg?.esGrupo).toBe(true);
  expect(msg?.autor).toBe("Juan");
});

test("el texto también se lee de extendedTextMessage", () => {
  const msg = normalizeEvolutionMessage({
    ...base,
    data: {
      ...base.data,
      message: { extendedTextMessage: { text: "mirá esto https://ejemplo.com/paper" } },
    },
  });

  expect(msg?.body).toBe("mirá esto https://ejemplo.com/paper");
});

test("los mensajes propios se aceptan: el chat con uno mismo es captura", () => {
  const msg = normalizeEvolutionMessage({
    ...base,
    data: { ...base.data, key: { ...base.data.key, fromMe: true } },
  });

  expect(msg).not.toBeNull();
  expect(msg?.autor).toBe("yo");
});

test("un evento que no es un mensaje se descarta", () => {
  expect(normalizeEvolutionMessage({ ...base, event: "connection.update" })).toBeNull();
});

test("un mensaje sin texto (sticker, imagen sin caption) se descarta", () => {
  expect(
    normalizeEvolutionMessage({
      ...base,
      data: { ...base.data, message: { stickerMessage: { url: "..." } } },
    }),
  ).toBeNull();
});

test("un payload malformado se descarta en vez de romper", () => {
  expect(normalizeEvolutionMessage(null)).toBeNull();
  expect(normalizeEvolutionMessage({})).toBeNull();
  expect(normalizeEvolutionMessage({ event: "messages.upsert", data: {} })).toBeNull();
  expect(normalizeEvolutionMessage("no soy un objeto")).toBeNull();
});
