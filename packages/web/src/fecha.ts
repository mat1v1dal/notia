export type ConFecha = { id: number; dueAt: string | null };

export type Grupo<T> = {
  titulo: string;
  urgente: boolean;
  items: T[];
};

function partes(fecha: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(fecha);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return {
    dia: `${v("year")}-${v("month")}-${v("day")}`,
    hora: Number(v("hour")),
    minuto: Number(v("minute")),
  };
}

export function estaVencido(dueAt: string | null, ahora: Date): boolean {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() < ahora.getTime();
}

/** Un vencimiento a las 00:00 locales es una fecha, no un momento. */
function esSoloFecha(dueAt: string, tz: string): boolean {
  const { hora, minuto } = partes(new Date(dueAt), tz);
  return hora === 0 && minuto === 0;
}

/** Cómo se lee la fecha en la lista: la hora si es hoy, el día si está más lejos. */
export function comoTexto(dueAt: string | null, ahora: Date, tz: string): string {
  if (!dueAt) return "";

  const fecha = new Date(dueAt);
  const hoy = partes(ahora, tz);
  const suyo = partes(fecha, tz);

  if (suyo.dia === hoy.dia && !esSoloFecha(dueAt, tz)) {
    return `${String(suyo.hora).padStart(2, "0")}:${String(suyo.minuto).padStart(2, "0")}`;
  }

  const diaMes = new Intl.DateTimeFormat("es-AR", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(fecha);

  if (esSoloFecha(dueAt, tz)) return diaMes;

  const hora = `${String(suyo.hora).padStart(2, "0")}:${String(suyo.minuto).padStart(2, "0")}`;
  return `${diaMes} ${hora}`;
}

/**
 * Agrupa por urgencia real. Los títulos no decoran: dicen cuánto tiempo
 * te queda, que es la única pregunta que le hacés a esta pantalla.
 */
export function agrupar<T extends ConFecha>(items: T[], ahora: Date, tz: string): Grupo<T>[] {
  const hoy = partes(ahora, tz).dia;
  const finDeSemana = new Date(ahora.getTime() + 7 * 86_400_000);

  const cubos: Record<string, T[]> = {
    Vencido: [],
    Hoy: [],
    "Esta semana": [],
    Después: [],
    "Sin fecha": [],
  };

  for (const item of items) {
    if (!item.dueAt) {
      cubos["Sin fecha"]!.push(item);
      continue;
    }
    const fecha = new Date(item.dueAt);
    const dia = partes(fecha, tz).dia;

    if (estaVencido(item.dueAt, ahora)) cubos.Vencido!.push(item);
    else if (dia === hoy) cubos.Hoy!.push(item);
    else if (fecha <= finDeSemana) cubos["Esta semana"]!.push(item);
    else cubos.Después!.push(item);
  }

  const porFecha = (a: T, b: T) =>
    new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime();

  return Object.entries(cubos)
    .filter(([, items]) => items.length > 0)
    .map(([titulo, items]) => ({
      titulo,
      urgente: titulo === "Vencido",
      items: titulo === "Sin fecha" ? items : [...items].sort(porFecha),
    }));
}
