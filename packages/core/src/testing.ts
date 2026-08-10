import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Db } from "./db.js";
import * as schema from "./schema.js";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

/**
 * Base efímera en memoria con el schema real aplicado desde las mismas
 * migraciones que corren en producción. Sin mocks: los tests de core
 * ejercitan Postgres de verdad.
 */
export async function makeTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}
