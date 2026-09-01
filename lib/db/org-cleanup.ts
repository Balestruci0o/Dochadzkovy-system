import { eq, sql } from "drizzle-orm";
import { adminDb } from "./admin";
import { organizations } from "./schema";

/**
 * Všeobecný, znovupoužiteľný nástroj na bezpečné zmazanie celej organizácie
 * a všetkého pod ňou. ZÁMERNE bez závislosti na vitest (na rozdiel od
 * `test-fixture.ts`) — používa ho aj jednorazový upratovací skript, nielen
 * testy.
 *
 * PREČO toto existuje: opakovane (raz s `attendance_days`, raz s
 * `punch_events` cez globálny trigger-disable, potom stovky osirotených
 * `users` riadkov) sa ukázalo, že ručne písaný
 * `afterAll(() => adminDb.delete(organizations)...)`
 * v každom testovacom súbore je krehký — buď naň niekto zabudne, alebo
 * zlyhá potichu na NECESKADUJÚCOM FK (napr. `generation_runs.triggered_by
 * → users.id`, `coverage_requirements.position_id → positions.id`) a CELÝ
 * DELETE sa (atomicky, správne) vráti — org ostane, nikto si to nevšimne,
 * kým sa nenahromadia stovky.
 *
 * `deleteOrgCascade` preto NEPREDPOKLADÁ, že pozná celý FK graf. Namiesto
 * toho: skúsi zmazať, a keď Postgres nahlási 23503 (foreign_key_violation),
 * PRIAMO Z CHYBY zistí, ktorý stĺpec v ktorej tabuľke blokuje (Postgres
 * error nesie `table_name`/`constraint_name`; `information_schema.
 * key_column_usage` z toho vytiahne presný názov stĺpca), ten stĺpec
 * vynuluje (alebo — ak je NOT NULL — zmaže blokujúci riadok, keďže ide o
 * vlastné testovacie dáta) a skúsi znova. Nový neceskadujúci FK, pridaný
 * kedykoľvek v budúcnosti, sa tak vyrieši SÁM — nikto nemusí tento helper
 * ručne aktualizovať.
 *
 * JEDINÁ vec, ktorú TOTO nevie obísť: `punch_events` má BEFORE DELETE
 * trigger (`trg_punch_no_delete`, append-only) — to
 * NIE JE FK violation (23503), je to `RAISE EXCEPTION`. Vtedy sa
 * `deleteOrgCascade` VZDÁVA (org ostane, s viditeľným console.warn) — to
 * je JEDINÝ bezpečný výsledok, punch_events sa nesmie mazať ani cez
 * dočasný trigger-disable (presne TAK sa #64 stalo — globálne vypnutie
 * triggera z jedného testovacieho súboru vie pokaziť append-only garanciu
 * iného, súbežne bežiaceho súboru).
 */

const FOREIGN_KEY_VIOLATION = "23503";
const NOT_NULL_VIOLATION = "23502";

async function findReferencingColumn(constraintName: string, tableName: string): Promise<string | null> {
  const rows = await adminDb.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.key_column_usage
    WHERE constraint_name = ${constraintName} AND table_name = ${tableName}
  `);
  return rows[0]?.column_name ?? null;
}

export async function deleteOrgCascade(orgId: string, maxAttempts = 30): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await adminDb.delete(organizations).where(eq(organizations.id, orgId));
      return;
    } catch (err) {
      const cause = (err as { cause?: { code?: string; table_name?: string; constraint_name?: string; detail?: string } }).cause;
      if (!cause || cause.code !== FOREIGN_KEY_VIOLATION || !cause.table_name || !cause.constraint_name) {
        // Append-only trigger (punch_events) alebo iná neopraviteľná prekážka.
        console.warn(`deleteOrgCascade: org ${orgId} sa nedá úplne zmazať (${cause?.code ?? "neznáma chyba"}), necháva sa v DB. Dôvod:`, (err as Error).message);
        return;
      }

      const column = await findReferencingColumn(cause.constraint_name, cause.table_name);
      if (!column) {
        console.warn(`deleteOrgCascade: FK violation na ${cause.table_name}, ale stĺpec sa nenašiel (constraint ${cause.constraint_name}) — vzdávam sa.`);
        return;
      }

      const idMatch = (cause.detail ?? "").match(/\(([0-9a-f-]{36})\)/);
      const blockingId = idMatch?.[1];
      if (!blockingId) {
        console.warn(`deleteOrgCascade: FK violation na ${cause.table_name}.${column}, ale ID blokujúceho riadku sa nedalo vyparsovať z "${cause.detail}" — vzdávam sa.`);
        return;
      }

      const table = sql.identifier(cause.table_name);
      const col = sql.identifier(column);
      try {
        await adminDb.execute(sql`UPDATE ${table} SET ${col} = NULL WHERE ${col} = ${blockingId}`);
      } catch (nullErr) {
        const nullCause = (nullErr as { cause?: { code?: string } }).cause;
        if (nullCause?.code === NOT_NULL_VIOLATION) {
          // Stĺpec je NOT NULL — nedá sa vynulovať, riadok je vlastné testovacie dáta, zmaž ho celý.
          await adminDb.execute(sql`DELETE FROM ${table} WHERE ${col} = ${blockingId}`);
        } else {
          throw nullErr;
        }
      }
      // slučka skúsi DELETE FROM organizations znova
    }
  }
  throw new Error(`deleteOrgCascade: org ${orgId} sa nepodarilo zmazať ani po ${maxAttempts} pokusoch — pozri predošlé console.warn.`);
}
