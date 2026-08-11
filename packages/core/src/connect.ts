import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { Db } from "./db.js";
import * as schema from "./schema.js";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export type Connection = { db: Db; close(): Promise<void> };

/** Conexión de producción. Las migraciones son las mismas que corren en los tests. */
export async function connect(databaseUrl: string, opts: { migrate?: boolean } = {}): Promise<Connection> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema }) as unknown as Db;

  if (opts.migrate !== false) {
    await migrate(db as never, { migrationsFolder });
  }

  return { db, close: () => pool.end() };
}
