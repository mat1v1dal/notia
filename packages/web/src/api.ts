export type Item = {
  id: number;
  content: string;
  url: string | null;
  dueAt: string | null;
  doneAt: string | null;
  context: string | null;
  tags: string[];
  source: "whatsapp" | "web";
  sourceJid: string | null;
};

export type Chat = {
  jid: string;
  nombre: string | null;
  esGrupo: boolean;
  tracked: boolean;
  lastSeenAt: string | null;
};

export type Cambio = {
  id: number;
  itemId: number;
  accion: "crear" | "editar" | "cerrar" | "reabrir";
  jid: string | null;
  motivo: string | null;
  undoneAt: string | null;
  createdAt: string;
  item: Item;
  undo_token: string;
};

/** La sesión venció o no existe. La app muestra el login en vez de romperse. */
export class SinSesion extends Error {}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

  if (res.status === 401) throw new SinSesion();
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Error ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  entrar: (password: string) =>
    pedir<{ ok: true }>("/login", { method: "POST", body: JSON.stringify({ password }) }),

  items: (params: { q?: string; estado?: "abiertos" | "todos" } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.estado) qs.set("estado", params.estado);
    return pedir<Item[]>(`/api/items?${qs}`);
  },

  crear: (content: string) =>
    pedir<Item>("/api/items", { method: "POST", body: JSON.stringify({ content }) }),

  editar: (id: number, cambios: Record<string, unknown>) =>
    pedir<Item>(`/api/items/${id}`, { method: "PATCH", body: JSON.stringify(cambios) }),

  cerrar: (id: number) => pedir<Item>(`/api/items/${id}/cerrar`, { method: "POST" }),
  reabrir: (id: number) => pedir<Item>(`/api/items/${id}/reabrir`, { method: "POST" }),

  chats: () => pedir<Chat[]>("/api/chats"),
  observar: (jid: string, tracked: boolean) =>
    pedir<Chat>(`/api/chats/${encodeURIComponent(jid)}`, {
      method: "PATCH",
      body: JSON.stringify({ tracked }),
    }),

  log: () => pedir<Cambio[]>("/api/log"),
};
