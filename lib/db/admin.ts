import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ============================================================================
// ADMIN klient — rola "postgres", rolbypassrls=true. RLS politiky sa NEVYHODNOCUJÚ.
//
// Použiť LEN tam, kde to docs/ARCHITECTURE.md výslovne uvádza (napr. punch endpoint
// po overení HMAC, cron generátora/auto-uzavretia) alebo v seed/migračných
// skriptoch. Bežný request-scoped kód v app/ a lib/ MUSÍ používať `db` /
// `withUserContext` z lib/db/index.ts, nie tento klient.
// ============================================================================

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL nie je nastavená");
}

// idle_timeout: session-mode pooler (Supavisor) má tvrdý strop na počet klientov
// (pool_size). Bez idle_timeout postgres.js drží spojenie otvorené navždy, takže
// zabudnuté/zamrznuté procesy (napr. duplicitný `next dev`) postupne vyčerpajú
// celý pool a nová appka/test sa už nepripojí.
const client = postgres(process.env.DATABASE_URL, { prepare: false, idle_timeout: 20 });

export const adminDb = drizzle(client, { schema });
