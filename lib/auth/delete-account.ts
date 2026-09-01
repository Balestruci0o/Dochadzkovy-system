import { and, eq, isNull, ne } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { employees, managerWorkplaces, users } from "@/lib/db/schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Tx = PostgresJsDatabase<typeof schema>;
type UserRow = typeof users.$inferSelect;

export type DeleteAccountCheck = { ok: true; target: UserRow } | { ok: false; message: string };
export type DeleteAccountOutcome = { ok: true } | { ok: false; message: string };

/**
 * "Zostane po vylúčení targetUserId v organizácii aspoň jeden AKTÍVNY
 * owner?" — spoločný invariant pre mazanie (`checkAccountDeletable`) AJ
 * deaktiváciu (`toggleAccountActiveAction`, Nastavenia → Kontá): jedno
 * miesto, jedna definícia "aktívny" (isActive=true, deletedAt IS NULL),
 * nech sa nerozíde medzi dvoma nezávislými kontrolami.
 */
export async function hasOtherActiveOwner(tx: Tx, orgId: string, excludingUserId: string): Promise<boolean> {
  const otherActiveOwners = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.orgId, orgId),
        eq(users.role, "owner"),
        eq(users.isActive, true),
        isNull(users.deletedAt),
        ne(users.id, excludingUserId),
      ),
    );
  return otherActiveOwners.length > 0;
}

/**
 * Poistky BEZ vedľajších účinkov — volá sa PRED poslaním kódu (rýchla spätná
 * väzba, netreba čakať na mail kvôli niečomu, čo aj tak nepôjde) aj ZNOVA
 * tesne pred samotným zmazaním (obrana proti pretekaniu — napr. dvaja
 * súbežné pokusy zmazať dvoch rôznych posledných ownerov naraz).
 */
export async function checkAccountDeletable(tx: Tx, actingUserId: string, targetUserId: string): Promise<DeleteAccountCheck> {
  if (targetUserId === actingUserId) {
    return { ok: false, message: "Nemôžeš zmazať svoje vlastné konto." };
  }

  const [target] = await tx.select().from(users).where(eq(users.id, targetUserId));
  if (!target || target.deletedAt) {
    return { ok: false, message: "Toto konto už neexistuje." };
  }

  if (target.role === "owner" && !(await hasOtherActiveOwner(tx, target.orgId, targetUserId))) {
    return {
      ok: false,
      message: "Toto je posledný aktívny majiteľ v organizácii — aspoň jeden musí vždy zostať, inak sa nikto nedostane do appky.",
    };
  }

  return { ok: true, target };
}

/**
 * Zmazanie PRIHLASOVACIEHO konta (Nastavenia → Kontá) — soft-delete, nie
 * fyzický DELETE (dôvod pozri migrácia 0044: `punch_events.created_by` a
 * podobné created_by/decided_by stĺpce by fyzický DELETE zablokovali takmer
 * vždy, a append-only trigger na `punch_events` nedovolí to obísť ani cez
 * ON DELETE SET NULL). `employees`/`punch_events`/celá história OSTÁVA —
 * len sa odpojí `employees.user_id` a zruší prihlasovacia identita.
 */
export async function deleteUserAccount(tx: Tx, actingUserId: string, targetUserId: string): Promise<DeleteAccountOutcome> {
  const guard = await checkAccountDeletable(tx, actingUserId, targetUserId);
  if (!guard.ok) return guard;
  const { target } = guard;

  if (target.authUserId) {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.deleteUser(target.authUserId);
    // code "user_not_found" = Auth účet už neexistuje (napr. opakovaný pokus
    // po predošlom čiastočnom zlyhaní) — to NIE JE chyba, pokračuj na DB krok.
    if (error && error.code !== "user_not_found") {
      return { ok: false, message: `Zmazanie prihlasovacieho účtu zlyhalo: ${error.message}` };
    }
  }

  await tx.update(users).set({ authUserId: null, email: null, isActive: false, deletedAt: new Date() }).where(eq(users.id, targetUserId));
  await tx.update(employees).set({ userId: null }).where(eq(employees.userId, targetUserId));
  await tx.delete(managerWorkplaces).where(eq(managerWorkplaces.userId, targetUserId));

  return { ok: true };
}
