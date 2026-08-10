import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema.js";

/**
 * Handle de base de datos que acepta tanto el driver de producción
 * (node-postgres) como el de tests (PGlite). Todo `core` habla contra
 * este tipo, así que nada de lo que escribimos queda atado a un driver.
 */
export type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Un `Db` o una transacción. Las funciones de core aceptan esto para poder
 * componerse dentro de una transacción del llamador sin abrir una anidada.
 */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
