import { createHmac, timingSafeEqual } from "node:crypto";

const LARGO = 10;

/**
 * Token de deshacer para un cambio del log.
 *
 * Se deriva del id con HMAC en vez de guardarse: no hace falta columna ni
 * limpieza, y un token no se puede adivinar a partir del id.
 */
export function undoToken(changeId: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(String(changeId))
    .digest("base64url")
    .slice(0, LARGO);
}

/** Comparación en tiempo constante: no filtra cuántos caracteres acertó quien prueba. */
export function verifyUndoToken(changeId: number, token: string, secret: string): boolean {
  const esperado = Buffer.from(undoToken(changeId, secret));
  const recibido = Buffer.from(token);

  if (esperado.length !== recibido.length) return false;
  return timingSafeEqual(esperado, recibido);
}
