import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ============================================================================
// Appka pripája pod rolou "app_user" (NOSUPERUSER, NOBYPASSRLS) — RLS politiky
// sa reálne vyhodnocujú. Rola "postgres" (lib/db/admin.ts) má rolbypassrls=true
// a smie sa použiť LEN tam, kde to docs/ARCHITECTURE.md výslovne uvádza.
// ============================================================================

if (!process.env.APP_DATABASE_URL) {
  throw new Error("APP_DATABASE_URL nie je nastavená");
}

// idle_timeout: session-mode pooler (Supavisor) má tvrdý strop na počet klientov
// (pool_size). Bez idle_timeout postgres.js drží spojenie otvorené navždy, takže
// zabudnuté/zamrznuté procesy (napr. duplicitný `next dev`) postupne vyčerpajú
// celý pool a nová appka/test sa už nepripojí.
const client = postgres(process.env.APP_DATABASE_URL, { prepare: false, idle_timeout: 20 });

export const db = drizzle(client, { schema });

/**
 * Spustí `fn` v transakcii so `SET LOCAL app.user_id`, ktoré RLS politiky
 * (current_user_id() v schema.sql) čítajú cez current_setting(). Toto MUSÍ
 * obaľovať každú request-scoped query — bez neho RLS politiky nevedia, kto
 * sa pýta, a väčšina SELECT/UPDATE vráti 0 riadkov.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
